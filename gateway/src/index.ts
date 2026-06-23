import { Kafka, logLevel } from "kafkajs";
import { SchemaRegistry, SchemaType } from "@kafkajs/confluent-schema-registry";
import { createApp } from "./app";
import { NotificationProducer } from "./kafka/producer";
import { ensureTopics } from "./kafka/topics";
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

  await registerSchemas(registry);
  await ensureTopics(kafka);

  const producer = new NotificationProducer(kafka, registry, "at-least-once");
  await producer.connect();

  console.log("[gateway] Kafka topics ensured, schemas registered");

  const app = createApp(producer);

  const server = app.listen(config.port, () => {
    console.log(
      `[gateway] Listening on port ${config.port} (${config.nodeEnv})`,
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[gateway] ${signal} received — shutting down`);
    server.close(async () => {
      await producer.disconnect();
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

async function registerSchemas(registry: SchemaRegistry): Promise<void> {
  const fs = await import("fs");
  const path = await import("path");

  // In local dev:  __dirname = src/   → src/avro
  // In Docker:     __dirname = dist/  → dist/avro  (Dockerfile copies src/avro → dist/avro)
  const schemaDir = path.resolve(__dirname, "avro");

  if (!fs.existsSync(schemaDir)) {
    console.warn("[gateway] Schema dir not found — skipping pre-registration");
    return;
  }

  const files = fs.readdirSync(schemaDir).filter((f) => f.endsWith(".avsc"));

  for (const file of files) {
    const raw = fs.readFileSync(path.join(schemaDir, file), "utf8");
    const schema = JSON.parse(raw);
    const subject = `notifications.${schema.name
      .replace(/([A-Z])/g, "-$1")
      .toLowerCase()
      .replace(/^-/, "")}-value`;

    try {
      const { id } = await registry.register(
        { type: SchemaType.AVRO, schema: raw },
        { subject },
      );
      console.log(`[registry] Registered ${subject} as id=${id}`);
    } catch (err: any) {
      if (!err.message?.includes("already exists")) throw err;
    }
  }
}

main().catch((err) => {
  console.error("[gateway] Fatal startup error", err);
  process.exit(1);
});
