import { Kafka, logLevel } from "kafkajs";
import { SchemaRegistry } from "@kafkajs/confluent-schema-registry";
import { EmailSender } from "./email/sender";
import { EmailConsumer } from "./kafka/consumer";
import { config } from "./config";

async function main(): Promise<void> {
  const kafka = new Kafka({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
    logLevel: logLevel.WARN,
    retry: {
      initialRetryTime: 300,
      retries: 10,
    },
  });

  const registry = new SchemaRegistry({ host: config.schemaRegistry.url });

  const sender = new EmailSender();
  await sender.verify();

  const consumer = new EmailConsumer(kafka, registry, sender);
  await consumer.start();

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[email-service] ${signal} received — stopping consumer`);
    await consumer.stop();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[email-service] Fatal startup error", err);
  process.exit(1);
});
