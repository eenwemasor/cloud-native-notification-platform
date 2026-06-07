/**
 * NotificationProducer — demonstrates the two delivery-guarantee models:
 *
 * ┌─────────────────┬──────────────────────────────────────────────────────┐
 * │ AT-LEAST-ONCE   │ Default. acks:'all', no transactions.                │
 * │                 │ Safe retries → duplicates possible on network error.  │
 * │                 │ Consumer must deduplicate on message.id.              │
 * ├─────────────────┼──────────────────────────────────────────────────────┤
 * │ EXACTLY-ONCE    │ idempotent:true + transactionalId.                   │
 * │                 │ Producer assigns each message a sequence number;     │
 * │                 │ broker rejects duplicates within the same epoch.     │
 * │                 │ Higher latency; requires consumers to read only       │
 * │                 │ committed messages (isolation.level:read_committed).  │
 * └─────────────────┴──────────────────────────────────────────────────────┘
 *
 * For this notification platform we use AT-LEAST-ONCE by default and rely
 * on the email-service to deduplicate via the notification `id` field.
 * The exactly-once path is shown as a teaching example.
 */

import { Kafka, Producer, Message } from "kafkajs";
import { SchemaRegistry } from "@kafkajs/confluent-schema-registry";
import type { EmailNotification } from "@notifications/schemas";
import { TOPICS } from "./topics";
import { config } from "../config";

type DeliveryMode = "at-least-once" | "exactly-once";

export class NotificationProducer {
  private kafka: Kafka;
  private registry: SchemaRegistry;
  private producer: Producer | null = null;
  private emailSchemaId: number | null = null;
  private readonly mode: DeliveryMode;

  constructor(kafka: Kafka, registry: SchemaRegistry, mode: DeliveryMode = "at-least-once") {
    this.kafka = kafka;
    this.registry = registry;
    this.mode = mode;
  }

  async connect(): Promise<void> {
    if (this.mode === "exactly-once") {
      // Exactly-once requires idempotence + a stable transactionalId.
      // The transactionalId ties producer state to a partition across restarts,
      // allowing the broker to fence zombie producers.
      this.producer = this.kafka.producer({
        idempotent: true,
        transactionalId: `gateway-txn-${config.kafka.clientId}`,
        maxInFlightRequests: 5,  // idempotent producers limit in-flight to 5
      });
    } else {
      // At-least-once: acks:'all' ensures all ISR replicas acknowledge.
      // Retries are safe but can produce duplicates; message.id deduplicates.
      this.producer = this.kafka.producer({
        allowAutoTopicCreation: false,
      });
    }

    await this.producer.connect();

    // Cache schema ID so we don't hit the registry on every send
    this.emailSchemaId = await this.registry.getLatestSchemaId(
      `${TOPICS.EMAIL_NOTIFICATIONS}-value`
    );

    console.log(
      `[producer] Connected (${this.mode}), emailSchemaId=${this.emailSchemaId}`
    );
  }

  async sendEmailNotification(notification: EmailNotification): Promise<void> {
    if (!this.producer) throw new Error("Producer not connected — call connect() first");
    if (this.emailSchemaId === null) throw new Error("Schema ID not cached");

    // Avro-encode the payload; the registry prepends the 5-byte magic + schemaId
    // wire format so the consumer can look up the schema automatically.
    const encodedValue = await this.registry.encode(
      this.emailSchemaId,
      notification
    );

    const message: Message = {
      // Keying by recipient keeps all notifications for the same address
      // in the same partition → ordering guarantee per recipient
      key: notification.to,
      value: encodedValue,
      headers: {
        "notification-id": notification.id,
        "content-type": "avro/binary",
      },
    };

    if (this.mode === "exactly-once") {
      await this.sendExactlyOnce(message);
    } else {
      await this.sendAtLeastOnce(message);
    }
  }

  // ── At-least-once ─────────────────────────────────────────────────────────

  private async sendAtLeastOnce(message: Message): Promise<void> {
    await this.producer!.send({
      topic: TOPICS.EMAIL_NOTIFICATIONS,
      messages: [message],
      acks: -1,  // -1 = 'all' — wait for all ISR replicas to acknowledge
    });
  }

  // ── Exactly-once ──────────────────────────────────────────────────────────
  // Wrap the send in a Kafka transaction.  Any failure aborts the transaction
  // so partial writes never become visible to read_committed consumers.

  private async sendExactlyOnce(message: Message): Promise<void> {
    const txn = await this.producer!.transaction();
    try {
      await txn.send({
        topic: TOPICS.EMAIL_NOTIFICATIONS,
        messages: [message],
      });
      await txn.commit();
    } catch (err) {
      await txn.abort();
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await this.producer?.disconnect();
    this.producer = null;
  }
}
