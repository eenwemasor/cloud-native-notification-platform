/**
 * EmailConsumer — at-least-once consumer with manual offset commits.
 *
 * Why manual commits?
 *   KafkaJS auto-commit advances the offset on a heartbeat timer regardless
 *   of whether the message was processed successfully.  If the process crashes
 *   after auto-commit but before SMTP send, the message is lost.
 *
 *   With manual commits we only advance the offset AFTER sendMail() resolves,
 *   guaranteeing at-least-once delivery at the cost of possible re-processing.
 *   The email-service deduplicates on notification.id to tolerate this.
 *
 * Consumer group scaling:
 *   All replicas of email-service share the same KAFKA_GROUP_ID.  Kafka
 *   assigns partitions across group members, so adding replicas increases
 *   throughput without duplicate sends (each partition has exactly one owner
 *   at a time within a group).
 */

import { Kafka, Consumer, EachMessagePayload, logLevel } from "kafkajs";
import { SchemaRegistry } from "@kafkajs/confluent-schema-registry";
import type { EmailNotification } from "@notifications/schemas";
import { EmailSender } from "../email/sender";
import { config } from "../config";

const EMAIL_TOPIC = "notifications.email";

export class EmailConsumer {
  private consumer: Consumer;
  private registry: SchemaRegistry;
  private sender: EmailSender;
  private seenIds = new Set<string>(); // in-process dedup (survives restart via idempotent DB in prod)

  constructor(kafka: Kafka, registry: SchemaRegistry, sender: EmailSender) {
    this.consumer = kafka.consumer({
      groupId: config.kafka.groupId,
      // Read only messages committed by producers (important for exactly-once producers)
      readUncommitted: false,
    });
    this.registry = registry;
    this.sender = sender;
  }

  async start(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: EMAIL_TOPIC, fromBeginning: false });

    await this.consumer.run({
      // Disable auto-commit — we commit only after successful email send
      autoCommit: false,
      eachMessage: async (payload) => this.handleMessage(payload),
    });

    console.log(`[consumer] Subscribed to ${EMAIL_TOPIC} (group: ${config.kafka.groupId})`);
  }

  private async handleMessage({
    topic,
    partition,
    message,
    heartbeat,
    commitOffsetsIfNecessary,
    resolveOffset,
  }: EachMessagePayload): Promise<void> {
    if (!message.value) return;

    // Avro decode — registry resolves schema from the 5-byte wire prefix
    const notification = await this.registry.decode(message.value) as EmailNotification;

    // Idempotency guard — skip if we already processed this notification ID
    if (this.seenIds.has(notification.id)) {
      console.warn(`[consumer] Duplicate notification skipped: ${notification.id}`);
      resolveOffset(message.offset);
      await commitOffsetsIfNecessary();
      return;
    }

    try {
      await this.sender.send(notification);
      this.seenIds.add(notification.id);

      console.log(
        `[consumer] Sent email to ${notification.to} (id=${notification.id}, partition=${partition}, offset=${message.offset})`
      );

      // Mark this offset as processed and commit it
      // resolveOffset must be called before commitOffsetsIfNecessary
      resolveOffset(message.offset);
      await commitOffsetsIfNecessary();
    } catch (err) {
      // Do NOT resolve or commit — Kafka will re-deliver this message after
      // the consumer rejoins or on the next poll cycle
      console.error(
        `[consumer] Failed to send email (id=${notification.id}):`,
        err
      );
      // Re-throw so KafkaJS pauses and retries this batch
      throw err;
    }
  }

  async stop(): Promise<void> {
    await this.consumer.disconnect();
  }
}
