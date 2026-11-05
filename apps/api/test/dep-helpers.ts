import { client, uniqueName, validAgent, type Who } from "./helpers.js";

type Api = ReturnType<typeof client>;

export const mkAgent = async (api: Api, w: Who, name = uniqueName("agent")): Promise<string> => {
  const res = await api.post("/api/v1/agents", w, validAgent({ name }));
  if (res.status !== 201) throw new Error(`agent create failed: ${res.raw}`);
  return res.body.data.id;
};

export const mkResource = async (api: Api, w: Who, name = uniqueName("res"), resourceType = "api"): Promise<string> => {
  const res = await api.post("/api/v1/resources", w, { name, resourceType });
  if (res.status !== 201) throw new Error(`resource create failed: ${res.raw}`);
  return res.body.data.id;
};

export const prov = { source: "manual" };

export const authority = (src: string, tgt: string, over: Record<string, unknown> = {}) => ({
  sourceType: "agent", sourceId: src, targetType: "agent", targetId: tgt,
  dependencyType: "authority", relationship: "delegates_authority",
  metadata: { scope: "payment.execute" }, provenance: prov, ...over,
});

export const resourceDep = (agent: string, resource: string, over: Record<string, unknown> = {}) => ({
  sourceType: "agent", sourceId: agent, targetType: "resource", targetId: resource,
  dependencyType: "resource", relationship: "accesses",
  metadata: { accessLevel: "read" }, provenance: prov, ...over,
});

export const operational = (src: string, tgt: string, over: Record<string, unknown> = {}) => ({
  sourceType: "agent", sourceId: src, targetType: "agent", targetId: tgt,
  dependencyType: "operational", relationship: "triggers", provenance: prov, ...over,
});

export const createDep = async (api: Api, w: Who, body: object): Promise<any> => {
  const res = await api.post("/api/v1/dependencies", w, body);
  if (res.status !== 201) throw new Error(`dependency create failed: ${res.raw}`);
  return res.body.data;
};

type Agents<N> = N extends 2 ? [string, string] : N extends 3 ? [string, string, string] : N extends 4 ? [string, string, string, string] : string[];

/** Creates n agents (2-4 return fixed-length tuples so destructuring is typed). */
export const mkAgents = async <N extends number>(api: Api, w: Who, n: N): Promise<Agents<N>> =>
  (await Promise.all(Array.from({ length: n }, () => mkAgent(api, w)))) as Agents<N>;
