import type { OrgTier } from "../organizations/organization.types.js";

export interface TierLimits {
  maxAgents: number;
  maxEdges: number;
  maxWebhooks: number;
}

export const TIER_LIMITS: Record<OrgTier, TierLimits> = {
  starter: {
    maxAgents: 10,
    maxEdges: 50,
    maxWebhooks: 1,
  },
  pro: {
    maxAgents: 100,
    maxEdges: 1000,
    maxWebhooks: 10,
  },
  enterprise: {
    maxAgents: Number.POSITIVE_INFINITY,
    maxEdges: Number.POSITIVE_INFINITY,
    maxWebhooks: Number.POSITIVE_INFINITY,
  },
};
