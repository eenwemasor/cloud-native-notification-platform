import { Kafka, Consumer, EachMessagePayload, logLevel } from "kafkajs";
import { SchemaRegistry } from "@kafkajs/confluent-schema-registry";
import type { EmailNotification } from "../types/notifications";
import { EmailSender } from "../email/sender";
import { config } from "../config";

const EMAIL_TOPIC = "notifications.email";

export class EmailConsumer {
  private consumer: Consumer;
  private registry: SchemaRegistry;
  private sender: EmailSender;
  private seenIds = new Set<string>();

  constructor(kafka: Kafka, registry: SchemaRegistry, sender: EmailSender) {
    this.consumer = kafka.consumer({
      groupId: config.kafka.groupId,
      readUncommitted: false,
    });
    this.registry = registry;
    this.sender = sender;
  }

  async start(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: EMAIL_TOPIC, fromBeginning: false });

    await this.consumer.run({
      autoCommit: false,
      eachMessage: async (payload) => this.handleMessage(payload),
    });

    console.log(`[consumer] Subscribed to ${EMAIL_TOPIC} (group: ${config.kafka.groupId})`);
  }

  private async handleMessage({
    topic,
    partition,
    message,
  }: EachMessagePayload): Promise<void> {
    if (!message.value) return;

    const notification = await this.registry.decode(message.value) as EmailNotification;

    if (this.seenIds.has(notification.id)) {
      console.warn(`[consumer] Duplicate skipped: ${notification.id}`);
      await this.commitOffset(topic, partition, message.offset);
      return;
    }

    try {
      await this.sender.send(notification);
      this.seenIds.add(notification.id);

      console.log(
        `[consumer] Sent email to ${notification.to} (id=${notification.id}, partition=${partition}, offset=${message.offset})`
      );

      await this.commitOffset(topic, partition, message.offset);
    } catch (err) {
      // Do NOT commit — Kafka re-delivers after consumer rejoin
      console.error(`[consumer] Failed to send email (id=${notification.id}):`, err);
      throw err;
    }
  }

  private async commitOffset(topic: string, partition: number, offset: string): Promise<void> {
    await this.consumer.commitOffsets([{
      topic,
      partition,
      offset: String(Number(offset) + 1),
    }]);
  }

  async stop(): Promise<void> {
    await this.consumer.disconnect();
  }
}
