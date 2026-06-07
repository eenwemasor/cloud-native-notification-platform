import nodemailer, { Transporter } from "nodemailer";
import type { EmailNotification } from "../types/notifications";
import { renderTemplate } from "./templates";
import { config } from "../config";

export class EmailSender {
  private transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      auth: config.smtp.auth,
    });
  }

  async send(notification: EmailNotification): Promise<void> {
    let subject = notification.subject;
    let html: string | undefined;
    let text: string | undefined;

    if (notification.template) {
      const rendered = renderTemplate(notification.template, notification.templateData);
      subject = rendered.subject;
      html = rendered.html;
    } else if (notification.isHtml) {
      html = notification.body;
    } else {
      text = notification.body;
    }

    await this.transporter.sendMail({
      from: config.smtp.from,
      to: notification.to,
      subject,
      text,
      html,
      headers: {
        "X-Notification-Id": notification.id,
      },
    });
  }

  async verify(): Promise<void> {
    await this.transporter.verify();
    console.log(`[email] SMTP connection verified (${config.smtp.host}:${config.smtp.port})`);
  }
}
