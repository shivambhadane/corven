import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QuotaEnforcer } from "../src/modules/saas/quotas/quota.enforcer.js";
import { QuotaExceededError } from "../src/errors.js";
import { createCtx, validAgent, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createCtx();
});
afterAll(() => ctx.close());

describe("SaaS: Subscription Tier Quotas", () => {
  const enforcer = new QuotaEnforcer();

  it("permits registration when within starter quota and enforces agent limit", async () => {
    const admin = who("admin");
    const orgId = admin.org;

    // Initially 0 agents, checking starter quota passes
    await expect(enforcer.checkAgentQuota(ctx.handle.db, orgId, "starter")).resolves.not.toThrow();

    // Register 10 agents (the starter maximum limit)
    for (let i = 0; i < 10; i++) {
      await ctx.registry.agents.register(
        { actorId: admin.actor, organizationId: orgId, role: "admin" },
        validAgent({ name: `agent-${i}` }) as never,
      );
    }

    // Now at 10 agents, checkAgentQuota must reject adding an 11th agent
    await expect(enforcer.checkAgentQuota(ctx.handle.db, orgId, "starter")).rejects.toThrow(
      QuotaExceededError,
    );

    // But under Pro or Enterprise tier, it passes
    await expect(enforcer.checkAgentQuota(ctx.handle.db, orgId, "pro")).resolves.not.toThrow();
    await expect(enforcer.checkAgentQuota(ctx.handle.db, orgId, "enterprise")).resolves.not.toThrow();
  });

  it("enforces webhook quota per tier", async () => {
    const admin = who("admin");
    const orgId = admin.org;
    const saas = ctx.app.saas;

    // Starter tier limit is 1 webhook
    await saas.webhooks.createWebhook(
      { actorId: admin.actor, organizationId: orgId, role: "admin" },
      { url: "https://example.com/hook1" },
    );

    // Starter quota now exceeded for additional webhooks
    await expect(enforcer.checkWebhookQuota(ctx.handle.db, orgId, "starter")).rejects.toThrow(
      QuotaExceededError,
    );

    // Pro tier allows up to 10 webhooks
    await expect(enforcer.checkWebhookQuota(ctx.handle.db, orgId, "pro")).resolves.not.toThrow();
  });
});
