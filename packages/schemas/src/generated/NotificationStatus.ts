// AUTO-GENERATED — run `npm run generate` to rebuild from notification-status.avsc
// DO NOT EDIT BY HAND

export type DeliveryStatus = "PENDING" | "SENT" | "FAILED" | "BOUNCED";

export interface NotificationStatus {
  /** Matches EmailNotification.id */
  notificationId: string;
  /** Name of the microservice that processed the notification */
  service: string;
  status: DeliveryStatus;
  /** Present when status is FAILED or BOUNCED */
  errorMessage: string | null;
  processedAt: number;
}
