const required = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

export const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",

  kafka: {
    // Comma-separated broker list, e.g. "kafka:29092" or "localhost:9092"
    brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
    clientId: "gateway",
  },

  schemaRegistry: {
    url: process.env.SCHEMA_REGISTRY_URL ?? "http://localhost:8081",
  },
} as const;
