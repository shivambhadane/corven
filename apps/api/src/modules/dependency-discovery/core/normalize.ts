import type { DiscoverySourceType, NormalizedObservation, RawDiscoveryRecord } from "../types.js";

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const ACCESS_LEVELS = ["read", "write", "admin", "unknown"];

export type NormalizationResult = { ok: true; observation: NormalizedObservation } | { ok: false; reason: string };

/**
 * Explicit, source-specific mapping rules. Nothing is inferred beyond them:
 *
 *   configuration tool -> targetAgent   operational "invokes"   (configured)
 *   configuration tool -> resource      resource    "accesses"  (configured; accessLevel only if stated)
 *   workflow step i -> step i+1         operational "triggers"  (declared)
 *   gateway event                       operational "calls"     (observed)
 *
 * No rule produces an authority dependency: a tool declaration, a workflow sequence
 * or a runtime interaction is not proof that authority was delegated.
 * Entity references stay as the source wrote them; no id is invented here.
 */
export function normalize(sourceType: DiscoverySourceType, raw: RawDiscoveryRecord): NormalizationResult {
  const p = raw.payload;
  const ts = raw.observedAt.toISOString();
  if (sourceType === "agent_configuration") {
    const agent = str(p.agent);
    const tool = isObj(p.tool) ? p.tool : null;
    if (!agent || !tool) return { ok: false, reason: "Missing agent or tool" };
    const operation = str(tool.operation) || undefined;
    const base = { evidenceKind: "configured" as const, evidenceSourceType: "agent_configuration" as const, evidence: { operation, timestamp: ts, reference: `tool:${str(tool.name)}` } };
    if (str(tool.targetAgent)) {
      return { ok: true, observation: { sourceEntity: { type: "agent", reference: agent }, targetEntity: { type: "agent", reference: str(tool.targetAgent) }, dependencyType: "operational", relationship: "invokes", metadata: {}, ...base } };
    }
    if (str(tool.resourceType)) {
      const metadata: Record<string, unknown> = {};
      const level = str(tool.accessLevel);
      if (level) {
        if (!ACCESS_LEVELS.includes(level)) return { ok: false, reason: `Unsupported accessLevel "${level.slice(0, 40)}"` };
        metadata.accessLevel = level;
      }
      return { ok: true, observation: { sourceEntity: { type: "agent", reference: agent }, targetEntity: { type: "resource", reference: str(tool.externalReference) || str(tool.name) }, dependencyType: "resource", relationship: "accesses", metadata, ...base } };
    }
    return { ok: false, reason: "Tool declares neither a target agent nor a resource" };
  }

  if (sourceType === "workflow_definition") {
    const from = isObj(p.from) ? p.from : null, to = isObj(p.to) ? p.to : null;
    if (!from || !to || !str(from.agent) || !str(to.agent)) return { ok: false, reason: "Workflow step is missing an agent" };
    return {
      ok: true,
      observation: {
        sourceEntity: { type: "agent", reference: str(from.agent) }, targetEntity: { type: "agent", reference: str(to.agent) },
        dependencyType: "operational", relationship: "triggers", metadata: {},
        evidenceKind: "declared", evidenceSourceType: "workflow_definition",
        evidence: { operation: str(to.operation) || undefined, timestamp: ts, reference: `workflow:${str(p.workflowId)}` },
      },
    };
  }

  const outcome = str(p.outcome) as "attempted" | "allowed" | "denied" | "completed";
  if (!str(p.sourceAgent) || !str(p.targetAgent)) return { ok: false, reason: "Event is missing sourceAgent or targetAgent" };
  return {
    ok: true,
    observation: {
      sourceEntity: { type: "agent", reference: str(p.sourceAgent) }, targetEntity: { type: "agent", reference: str(p.targetAgent) },
      dependencyType: "operational", relationship: "calls", metadata: {},
      evidenceKind: "observed", evidenceSourceType: "runtime_event", outcome,
      evidence: { operation: str(p.operation) || undefined, timestamp: ts, reference: `event:${str(p.eventId)}` },
    },
  };
}
