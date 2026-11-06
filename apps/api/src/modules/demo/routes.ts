import { randomUUID } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { AppError } from "../../errors.js";
import type { ResourceExecutors } from "../authorization-gateway/index.js";
import { DEMO_AGENTS, DEMO_RESOURCES, seedDemo } from "./seed.js";
import type { DemoTokens } from "./token.js";

export const DEMO_ORGANIZATION_NAME = "Acme Technologies";
export const DEMO_SESSION_SECONDS = 2 * 60 * 60;

/** Fixed-window counter. In-memory on purpose: demo sessions themselves only live as long as this process. */
export class WindowLimiter {
  private readonly hits = new Map<string, { start: number; n: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly now: () => number = Date.now) {}
  take(key: string): boolean {
    const t = this.now();
    const h = this.hits.get(key);
    if (!h || t - h.start >= this.windowMs) {
      this.hits.set(key, { start: t, n: 1 });
      if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (t - v.start >= this.windowMs) this.hits.delete(k);
      return true;
    }
    if (h.n >= this.limit) return false;
    h.n++;
    return true;
  }
}

export interface DemoRoutesOptions {
  tokens: DemoTokens;
  executors: ResourceExecutors;
  perClient: WindowLimiter;
  global: WindowLimiter;
}

export const demoRoutes: FastifyPluginAsyncTypebox<DemoRoutesOptions> = async (app, { tokens, executors, perClient, global }) => {
  /**
   * Start (or restart: "reset") a public demo. Each call creates a brand-new sandbox organization seeded with the Acme
   * Technologies network, so a reset is always a clean baseline and visitors never see each other's data.
   */
  app.post("/demo/sessions", { config: { auth: "public" } }, async (req, reply) => {
    if (!global.take("all") || !perClient.take(req.ip)) {
      throw new AppError(429, "DEMO_RATE_LIMITED", "Too many demo sessions started. Please wait a few minutes and try again.");
    }
    const organizationId = randomUUID();
    const { token, expiresAt } = tokens.issue(organizationId, DEMO_SESSION_SECONDS);
    const env = await seedDemo(app, token, executors);
    void reply.header("cache-control", "no-store");
    return reply.code(201).send({
      data: {
        token,
        organizationId,
        organizationName: DEMO_ORGANIZATION_NAME,
        environment: "demo",
        expiresAt: expiresAt.toISOString(),
        personas: ["admin", "operator", "approver"],
        agents: DEMO_AGENTS.map((a) => ({ key: a.key, id: env.agents[a.key], name: a.name, description: a.description })),
        resources: DEMO_RESOURCES.map((r) => ({ key: r.key, id: env.resources[r.key], name: r.name, description: r.description })),
        credentialsIssued: env.credentialsIssued,
        notice: "Simulated data. Enforcement runs through CORVEN's real gateway against simulated executors; nothing outside CORVEN is changed.",
      },
    });
  });
};
