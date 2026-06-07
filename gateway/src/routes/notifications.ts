import { Router, Request, Response } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { EmailNotification } from "../types/notifications";
import { NotificationProducer } from "../kafka/producer";
import { validate } from "../middleware/validate";

const SendEmailSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(998),
  body: z.string().min(1),
  isHtml: z.boolean().default(false),
  template: z.string().optional(),
  templateData: z.record(z.string()).default({}),
  metadata: z.record(z.string()).default({}),
});

type SendEmailRequest = z.infer<typeof SendEmailSchema>;

export function notificationsRouter(producer: NotificationProducer): Router {
  const router = Router();

  router.post(
    "/email",
    validate(SendEmailSchema),
    async (req: Request, res: Response): Promise<void> => {
      const body = req.body as SendEmailRequest;

      const notification: EmailNotification = {
        id: uuidv4(),
        to: body.to,
        subject: body.subject,
        body: body.body,
        isHtml: body.isHtml,
        template: body.template ?? null,
        templateData: body.templateData,
        metadata: body.metadata,
        timestamp: Date.now(),
      };

      try {
        await producer.sendEmailNotification(notification);
        res.status(202).json({
          id: notification.id,
          status: "queued",
          message: "Notification accepted and queued for delivery",
        });
      } catch (err) {
        console.error("[route] Failed to publish notification", err);
        res.status(503).json({
          error: "Failed to queue notification — Kafka unavailable",
        });
      }
    }
  );

  router.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "gateway" });
  });

  return router;
}
