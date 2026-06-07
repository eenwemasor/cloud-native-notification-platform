export const TOPICS = {
  EMAIL_NOTIFICATIONS: "notifications.email",
  NOTIFICATION_STATUS: "notifications.status",
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];
