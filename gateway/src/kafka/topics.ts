import { Kafka } from "kafkajs";

export const TOPICS = {
  EMAIL_NOTIFICATIONS: "notifications.email",
  NOTIFICATION_STATUS: "notifications.status",
} as const;

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
        numPartitions: 3,
        replicationFactor: 1,
      })),
    });

    console.log(`[kafka] Created topics: ${toCreate.join(", ")}`);
  } finally {
    await admin.disconnect();
  }
}
