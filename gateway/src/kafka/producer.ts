import { Kafka, Producer, Message } from "kafkajs";
import { SchemaRegistry } from "@kafkajs/confluent-schema-registry";
import type { EmailNotification } from "../types/notifications";
import { TOPICS } from "./topics";
import { config } from "../config";

type DeliveryMode = "at-least-once" | "exactly-once";

export class NotificationProducer {
  private kafka: Kafka;
  private registry: SchemaRegistry;
  private producer: Producer | null = null;
  private emailSchemaId: number | null = null;
  private readonly mode: DeliveryMode;

  constructor(
    kafka: Kafka,
    registry: SchemaRegistry,
    mode: DeliveryMode = "at-least-once",
  ) {
    this.kafka = kafka;
    this.registry = registry;
    this.mode = mode;
  }

  async connect(): Promise<void> {
    if (this.mode === "exactly-once") {
      this.producer = this.kafka.producer({
        idempotent: true,
        transactionalId: `gateway-txn-${config.kafka.clientId}`,
        maxInFlightRequests: 5,
      });
    } else {
      this.producer = this.kafka.producer({
        allowAutoTopicCreation: false,
      });
    }

    await this.producer.connect();
    console.log(
      `[producer] Connecting (${this.mode})`,
      `notifications.${TOPICS.EMAIL_NOTIFICATIONS.replace(/\./g, "-")}-value`,
    );
    this.emailSchemaId = await this.registry.getLatestSchemaId(
      `notifications.${TOPICS.EMAIL_NOTIFICATIONS.replace(/\./g, "-")}-value`,
    );

    console.log(
      `[producer] Connected (${this.mode}), emailSchemaId=${this.emailSchemaId}`,
    );
  }

  async sendEmailNotification(notification: EmailNotification): Promise<void> {
    if (!this.producer)
      throw new Error("Producer not connected — call connect() first");
    if (this.emailSchemaId === null) throw new Error("Schema ID not cached");

    const encodedValue = await this.registry.encode(
      this.emailSchemaId,
      notification,
    );

    const message: Message = {
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

  private async sendAtLeastOnce(message: Message): Promise<void> {
    await this.producer!.send({
      topic: TOPICS.EMAIL_NOTIFICATIONS,
      messages: [message],
      acks: -1,
    });
  }

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
