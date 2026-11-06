import { count, eq } from "drizzle-orm";
import type { Executor } from "../../../db/client.js";
import { agents, dependencies, webhooks } from "../../../db/schema.js";
import { QuotaExceededError } from "../../../errors.js";
import type { OrgTier } from "../organizations/organization.types.js";
import { TIER_LIMITS } from "./quota.types.js";

export class QuotaEnforcer {
  async checkAgentQuota(db: Executor, organizationId: string, tier: OrgTier): Promise<void> {
    const limit = TIER_LIMITS[tier]?.maxAgents ?? TIER_LIMITS.starter.maxAgents;
    if (!Number.isFinite(limit)) return;

    const [row] = await db
      .select({ total: count() })
      .from(agents)
      .where(eq(agents.organizationId, organizationId));

    const current = Number(row?.total ?? 0);
    if (current >= limit) {
      throw new QuotaExceededError(
        `Plan limit reached: ${tier} tier allows up to ${limit} agents (currently ${current}). Upgrade to add more agents.`,
      );
    }
  }

  async checkEdgeQuota(db: Executor, organizationId: string, tier: OrgTier): Promise<void> {
    const limit = TIER_LIMITS[tier]?.maxEdges ?? TIER_LIMITS.starter.maxEdges;
    if (!Number.isFinite(limit)) return;

    const [row] = await db
      .select({ total: count() })
      .from(dependencies)
      .where(eq(dependencies.organizationId, organizationId));

    const current = Number(row?.total ?? 0);
    if (current >= limit) {
      throw new QuotaExceededError(
        `Plan limit reached: ${tier} tier allows up to ${limit} dependency edges (currently ${current}). Upgrade to add more dependencies.`,
      );
    }
  }

  async checkWebhookQuota(db: Executor, organizationId: string, tier: OrgTier): Promise<void> {
    const limit = TIER_LIMITS[tier]?.maxWebhooks ?? TIER_LIMITS.starter.maxWebhooks;
    if (!Number.isFinite(limit)) return;

    const [row] = await db
      .select({ total: count() })
      .from(webhooks)
      .where(eq(webhooks.organizationId, organizationId));

    const current = Number(row?.total ?? 0);
    if (current >= limit) {
      throw new QuotaExceededError(
        `Plan limit reached: ${tier} tier allows up to ${limit} webhooks (currently ${current}). Upgrade to configure more webhooks.`,
      );
    }
  }
}
