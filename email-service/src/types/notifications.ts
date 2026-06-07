export interface EmailNotification {
  /** UUID v4 — idempotency key for deduplication */
  id: string;
  to: string;
  subject: string;
  body: string;
  isHtml: boolean;
  template: string | null;
  templateData: Record<string, string>;
  metadata: Record<string, string>;
  timestamp: number;
}
