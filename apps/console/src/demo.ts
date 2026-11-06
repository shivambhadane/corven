import { api, type Session } from "./api";

/**
 * Builds the Acme network used throughout the docs, through the real API:
 * Support Agent delegates to Payment Agent; Payment uses the Wallet and the Customer API; Support and
 * Database also use the Customer API; Payment triggers Analytics. Resources are declared gateway-protected,
 * agents get machine credentials and grants, so containment can be planned, enforced and verified.
 */
export async function seedAcme(admin: Session, log: (m: string) => void) {
  const stamp = Date.now().toString(36);
  const agent = async (name: string) => (await api.post("/agents", { name: `${name}-${stamp}`, agentType: "llm", externalReference: `${name}-${stamp}` }, admin)).data.id as string;
  const resource = async (name: string) => (await api.post("/resources", { name: `${name}-${stamp}`, resourceType: "api" }, admin)).data.id as string;
  log("registering agents");
  const support = await agent("support-agent"), payment = await agent("payment-agent"), analytics = await agent("analytics-agent"), database = await agent("database-agent");
  log("registering resources");
  const wallet = await resource("wallet"), customerApi = await resource("customer-api");
  const dep = (b: object) => api.post("/dependencies", { provenance: { source: "manual" }, ...b }, admin);
  log("recording dependencies");
  await dep({ sourceType: "agent", sourceId: support, targetType: "agent", targetId: payment, dependencyType: "authority", relationship: "delegates_authority", metadata: { scope: "payment.execute" } });
  for (const [a, r] of [[payment, wallet], [payment, customerApi], [support, customerApi], [database, customerApi]] as const)
    await dep({ sourceType: "agent", sourceId: a, targetType: "resource", targetId: r, dependencyType: "resource", relationship: "accesses", metadata: { accessLevel: "read" } });
  await dep({ sourceType: "agent", sourceId: payment, targetType: "agent", targetId: analytics, dependencyType: "operational", relationship: "triggers" });
  log("declaring gateway enforcement and grants");
  for (const r of [wallet, customerApi]) await api.put(`/gateway/resources/${r}/enforcement`, { mode: "gateway" }, admin);
  for (const a of [support, payment, analytics, database]) await api.post("/agent-auth/credentials", { agentId: a }, admin); // secrets in the responses are discarded
  for (const [a, r, action] of [[payment, wallet, "transfer"], [payment, customerApi, "read"], [support, customerApi, "read"], [database, customerApi, "read"]] as const)
    await api.post("/permissions", { agentId: a, resourceId: r, action }, admin);
  log("done");
  return { support, payment, analytics, database, wallet, customerApi };
}
