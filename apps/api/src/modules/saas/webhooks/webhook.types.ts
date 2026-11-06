export const WEBHOOK_EVENTS = [
  "incident.detected",
  "containment.proposed",
  "containment.approved",
  "containment.executed",
  "agent.compromised",
  "agent.suspended",
  "evidence.anchored",
  "*",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookRecord {
  id: string;
  organizationId: string;
  url: string;
  secret: string;
  events: string[];
  status: "active" | "disabled";
  createdAt: Date;
}

export interface WebhookDeliveryRecord {
  id: string;
  organizationId: string;
  webhookId: string;
  event: string;
  statusCode: number | null;
  durationMs: number | null;
  success: boolean;
  error: string | null;
  createdAt: Date;
}

export interface CreateWebhookInput {
  url: string;
  events?: string[];
}

export interface WebhookDto {
  id: string;
  organizationId: string;
  url: string;
  secret: string;
  events: string[];
  status: "active" | "disabled";
  createdAt: string;
}

export interface WebhookDeliveryDto {
  id: string;
  organizationId: string;
  webhookId: string;
  event: string;
  statusCode: number | null;
  durationMs: number | null;
  success: boolean;
  error: string | null;
  createdAt: string;
}
