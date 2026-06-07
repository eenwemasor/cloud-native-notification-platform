import express, { Application } from "express";
import { notificationsRouter } from "./routes/notifications";
import type { NotificationProducer } from "./kafka/producer";

export function createApp(producer: NotificationProducer): Application {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/notifications", notificationsRouter(producer));

  return app;
}
