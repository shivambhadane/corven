import type { FastifyInstance } from "fastify";
import { SimulatedExecutor, type ResourceExecutors } from "../authorization-gateway/index.js";

/**
 * The Acme Technologies sandbox. Deterministic: the same five agents, three resources and dependencies every time.
 *
 *   Support ──delegates authority──▶ Payment ──accesses──▶ Payment Wallet
 *      │                               └──triggers──▶ Analytics ──triggers──▶ Email ──accesses──▶ Email Provider
 *      └──accesses──▶ Customer API ◀──accesses── Database   (shared resource, independent path)
 */
export const DEMO_AGENTS = [
  { key: "support", name: "Support Agent", externalReference: "support-agent", agentType: "llm", description: "Answers customer tickets and can hand payment tasks to the Payment Agent." },
  { key: "payment", name: "Payment Agent", externalReference: "payment-agent", agentType: "llm", description: "Issues refunds from the payment wallet when the Support Agent delegates it." },
  { key: "database", name: "Database Agent", externalReference: "database-agent", agentType: "service", description: "Keeps customer records in sync. Reads the Customer API on its own schedule." },
  { key: "analytics", name: "Analytics Agent", externalReference: "analytics-agent", agentType: "workflow", description: "Summarises payment activity after each refund run." },
  { key: "email", name: "Email Agent", externalReference: "email-agent", agentType: "service", description: "Sends the summary e-mail Analytics produces." },
] as const;
export const DEMO_RESOURCES = [
  { key: "customerApi", name: "Customer API", resourceType: "api", description: "Customer records. Shared by the Support and Database agents." },
  { key: "wallet", name: "Payment Wallet", resourceType: "wallet", description: "Holds refund funds. Only the Payment Agent may transfer." },
  { key: "emailProvider", name: "Email Provider", resourceType: "service", description: "Outbound e-mail used by the Email Agent." },
] as const;
type AgentKey = (typeof DEMO_AGENTS)[number]["key"];
type ResourceKey = (typeof DEMO_RESOURCES)[number]["key"];

export interface DemoEnvironment {
  agents: Record<AgentKey, string>;
  resources: Record<ResourceKey, string>;
  /** Agent credentials are only issued when the server has agent authentication configured. */
  credentialsIssued: boolean;
}

export class DemoSeedError extends Error {}

/** Seeds through the SAME validated HTTP routes the console and customers use; nothing is written behind the API's back. */
export async function seedDemo(app: FastifyInstance, token: string, executors: ResourceExecutors): Promise<DemoEnvironment> {
  const headers = { "x-corven-demo": token, "x-corven-demo-persona": "admin" };
  const call = async (method: "POST" | "PUT", url: string, payload: object, allowFail = false) => {
    const res = await app.inject({ method, url: `/api/v1${url}`, headers, payload });
    if (res.statusCode >= 300) {
      if (allowFail) return null;
      throw new DemoSeedError(`demo seed failed at ${method} ${url}: ${res.statusCode} ${res.body.slice(0, 200)}`);
    }
    return res.json() as { data: { id: string } };
  };

  const agents = {} as Record<AgentKey, string>;
  for (const a of DEMO_AGENTS) agents[a.key] = (await call("POST", "/agents", { name: a.name, externalReference: a.externalReference, agentType: a.agentType, description: a.description }))!.data.id;
  const resources = {} as Record<ResourceKey, string>;
  for (const r of DEMO_RESOURCES) resources[r.key] = (await call("POST", "/resources", { name: r.name, resourceType: r.resourceType, description: r.description }))!.data.id;

  const dep = (b: object) => call("POST", "/dependencies", { provenance: { source: "manual" }, ...b });
  const agentToAgent = (s: AgentKey, t: AgentKey, dependencyType: string, relationship: string, metadata?: object) =>
    dep({ sourceType: "agent", sourceId: agents[s], targetType: "agent", targetId: agents[t], dependencyType, relationship, ...(metadata ? { metadata } : {}) });
  const agentToResource = (s: AgentKey, r: ResourceKey, accessLevel: string) =>
    dep({ sourceType: "agent", sourceId: agents[s], targetType: "resource", targetId: resources[r], dependencyType: "resource", relationship: "accesses", metadata: { accessLevel } });

  await agentToAgent("support", "payment", "authority", "delegates_authority", { scope: "payment.refund" });
  await agentToResource("support", "customerApi", "read");
  await agentToResource("payment", "wallet", "write");
  await agentToAgent("payment", "analytics", "operational", "triggers");
  await agentToAgent("analytics", "email", "operational", "triggers");
  await agentToResource("database", "customerApi", "read");
  await agentToResource("email", "emailProvider", "write");

  // Every sandbox resource sits behind the enforcement gateway and is served by a simulated executor: nothing outside CORVEN is touched.
  for (const id of Object.values(resources)) {
    executors.register(id, new SimulatedExecutor());
    await call("PUT", `/gateway/resources/${id}/enforcement`, { mode: "gateway" });
  }
  let credentialsIssued = true;
  for (const id of Object.values(agents)) if (!(await call("POST", "/agent-auth/credentials", { agentId: id }, true))) credentialsIssued = false;
  const grants: Array<[AgentKey, ResourceKey, string]> = [["support", "customerApi", "read"], ["payment", "wallet", "transfer"], ["database", "customerApi", "read"], ["email", "emailProvider", "send"]];
  for (const [a, r, action] of grants) await call("POST", "/permissions", { agentId: agents[a], resourceId: resources[r], action });

  return { agents, resources, credentialsIssued };
}
