import { buildGraph } from "../src/modules/graph-engine/core/builder.js";
import type { AgentRecord, DependencyRecord, ResourceRecord } from "../src/modules/graph-engine/types/graph.types.js";

export const ORG = "org-1";
const T0 = new Date("2026-11-01T00:00:00Z");

type Dep = [source: string, target: string, type?: string, over?: Partial<DependencyRecord>];

/** Agents are plain names, resources are written "R:name". */
export interface MutableInput {
  agents: AgentRecord[];
  resources: ResourceRecord[];
  dependencies: DependencyRecord[];
}

export function spec(names: string[], deps: Dep[], org = ORG): MutableInput {
  const isRes = (n: string) => n.startsWith("R:");
  const kind = (n: string) => (isRes(n) ? "resource" : "agent");
  const id = (n: string) => (isRes(n) ? n.slice(2) : n);
  return {
    agents: names.filter((n) => !isRes(n)).map((n) => ({ id: n, organizationId: org, name: n, status: "active", agentType: "llm", externalReference: null })),
    resources: names.filter(isRes).map((n) => ({ id: id(n), organizationId: org, name: id(n), resourceType: "api", externalReference: null })),
    dependencies: deps.map(([s, t, type = "operational", over], i) => ({
      id: `dep-${String(i).padStart(4, "0")}-${s}-${t}`,
      organizationId: org,
      sourceType: kind(s), sourceId: id(s), targetType: kind(t), targetId: id(t),
      dependencyType: type, relationship: "rel", status: "active", confidence: 0.9,
      provenance: { source: "manual" }, metadata: {}, version: 1, createdAt: T0, updatedAt: T0,
      ...over,
    })),
  };
}

export const build = (names: string[], deps: Dep[], org = ORG) => buildGraph(org, spec(names, deps, org)).graph;
export const a = (n: string) => `agent:${n}`;
export const r = (n: string) => `resource:${n}`;
