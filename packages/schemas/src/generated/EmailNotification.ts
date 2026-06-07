// AUTO-GENERATED — run `npm run generate` to rebuild from email-notification.avsc
// DO NOT EDIT BY HAND

export interface EmailNotification {
  /** UUID v4 — idempotency key for deduplication on the consumer side */
  id: string;
  /** Recipient email address */
  to: string;
  subject: string;
  /** Plain-text or HTML body */
  body: string;
  isHtml: boolean;
  /** Optional template name (email-service resolves to HTML) */
  template: string | null;
  /** Key-value pairs injected into the template */
  templateData: Record<string, string>;
  /** Arbitrary caller-supplied metadata passed through unchanged */
  metadata: Record<string, string>;
  /** Unix epoch milliseconds at which the gateway created this event */
  timestamp: number;
}
