import { Kafka } from "kafkajs";
import { config } from "../config";

export const TOPICS = {
  EMAIL_NOTIFICATIONS: "notifications.email",
  NOTIFICATION_STATUS: "notifications.status",
} as const;

/**
 * Pre-create topics with explicit partition counts so we don't rely on
 * Kafka's auto-create defaults in production-like environments.
 */
export async function ensureTopics(kafka: Kafka): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();

  try {
    const existing = await admin.listTopics();
    const toCreate = Object.values(TOPICS).filter((t) => !existing.includes(t));

    if (toCreate.length === 0) return;

    await admin.createTopics({
      waitForLeaders: true,
      topics: toCreate.map((topic) => ({
        topic,
        numPartitions: 3,      // 3 partitions → up to 3 parallel consumers
        replicationFactor: 1,  // single broker in local dev
      })),
    });

    console.log(`[kafka] Created topics: ${toCreate.join(", ")}`);
  } finally {
    await admin.disconnect();
  }
}
