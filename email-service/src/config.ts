export const config = {
  kafka: {
    brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
    clientId: "email-service",
    groupId: process.env.KAFKA_GROUP_ID ?? "email-service-group",
  },
  schemaRegistry: {
    url: process.env.SCHEMA_REGISTRY_URL ?? "http://localhost:8081",
  },
  smtp: {
    host: process.env.SMTP_HOST ?? "localhost",
    port: parseInt(process.env.SMTP_PORT ?? "1025", 10),
    from: process.env.SMTP_FROM ?? "notifications@example.com",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
      : undefined,
  },
} as const;
