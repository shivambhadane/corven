import { describe, expect, it } from "vitest";
import { ADAPTERS, validateRuntimeEvent, MAX_DOCUMENTS, type DiscoveryContext } from "../src/modules/dependency-discovery/core/adapters.js";
import { confidenceFor } from "../src/modules/dependency-discovery/core/confidence.js";
import { normalize } from "../src/modules/dependency-discovery/core/normalize.js";
import { classify, findIntraRunConflicts, metadataDiffers, type ExistingDependency } from "../src/modules/dependency-discovery/core/reconcile.js";
import { redact, redactPayload } from "../src/modules/dependency-discovery/core/redact.js";
import { memoizeLookup, resolveEntity, type EntityLookup } from "../src/modules/dependency-discovery/core/resolve.js";

const NOW = new Date("2026-11-06T10:00:00Z");
const ctx = (over: Partial<DiscoveryContext> = {}): DiscoveryContext => ({ organizationId: "org", discoveryRunId: "run", sourceId: "src", now: NOW, ...over });
const collect = async (type: keyof typeof ADAPTERS, config: Record<string, unknown>, c = ctx()) => {
  const out: any[] = [];
  for await (const r of ADAPTERS[type].discover(config, c)) out.push(r);
  return out;
};
const doc = (id: string, content: unknown) => ({ documents: [{ id, content }] });

describe("agent configuration adapter", () => {
  const cfg = { agent: "support-agent", tools: [{ name: "payment-service", targetAgent: "payment-agent", operation: "request_payment" }, { name: "customer-api", resourceType: "api" }] };

  it("emits one record per tool from the spec's example", async () => {
    const recs = await collect("agent_configuration", doc("d1", cfg));
    expect(recs.map((r) => r.externalRecordId)).toEqual(["d1#support-agent->payment-service", "d1#support-agent->customer-api"]);
    expect(recs[0].payload).toEqual({ agent: "support-agent", tool: cfg.tools[0] });
    expect(recs[0].observedAt).toEqual(NOW);
  });

  it("rejects malformed documents and ambiguous tools with a reason instead of throwing", async () => {
    const recs = await collect("agent_configuration", { documents: [
      { id: "bad", content: { tools: [] } },
      { id: "amb", content: { agent: "a", tools: [{ name: "x", targetAgent: "b", resourceType: "api" }, { name: "y" }, { noName: 1 }] } },
    ] });
    expect(recs.every((r) => r.rejected)).toBe(true);
    expect(recs.map((r) => r.reason)).toEqual([
      "Configuration must be an object with an agent and a tools array",
      "Tool must declare exactly one of targetAgent or resourceType",
      "Tool must declare exactly one of targetAgent or resourceType",
      "Tool needs a name",
    ]);
  });

  it("validates the configuration: shape, count, ids, size", () => {
    const a = ADAPTERS.agent_configuration;
    expect(() => a.validateConfiguration({})).toThrow(/documents must be an array/);
    expect(() => a.validateConfiguration({ documents: [{ id: "has space", content: {} }] })).toThrow(/id of letters/);
    expect(() => a.validateConfiguration({ documents: [{ id: "a", content: {} }, { id: "a", content: {} }] })).toThrow(/Duplicate/);
    expect(() => a.validateConfiguration({ documents: Array.from({ length: MAX_DOCUMENTS + 1 }, (_, i) => ({ id: `d${i}`, content: {} })) })).toThrow(/At most/);
    expect(() => a.validateConfiguration({ documents: [{ id: "big", content: { x: "y".repeat(70_000) } }] })).toThrow(/exceeds/);
    expect(() => a.validateConfiguration(doc("ok", cfg))).not.toThrow();
  });
});

describe("workflow definition adapter", () => {
  it("emits an operational candidate per consecutive step pair, never authority", async () => {
    const wf = { workflowId: "pay", steps: [{ agent: "support-agent", operation: "request_payment" }, { agent: "payment-agent", operation: "execute_payment" }, { agent: "analytics-agent", operation: "record" }] };
    const recs = await collect("workflow_definition", doc("w", wf));
    expect(recs.map((r) => r.externalRecordId)).toEqual(["pay#0", "pay#1"]);
    const norm = recs.map((r) => normalize("workflow_definition", r));
    expect(norm.every((n) => n.ok && n.observation.dependencyType === "operational")).toBe(true);
  });

  it("rejects too-short and malformed workflows", async () => {
    const recs = await collect("workflow_definition", { documents: [{ id: "a", content: { workflowId: "x", steps: [{ agent: "a" }] } }, { id: "b", content: { steps: [] } }, { id: "c", content: { workflowId: "y", steps: [{ agent: "a" }, { nope: 1 }] } }] });
    expect(recs.map((r) => r.reason)).toEqual(["A workflow needs at least two steps to describe a dependency", "Workflow must be an object with a workflowId and a steps array", "Every step needs an agent"]);
  });
});

describe("runtime gateway adapter", () => {
  const ev = { eventId: "evt_001", sourceAgent: "support-agent", targetAgent: "payment-agent", operation: "request_payment", outcome: "allowed", timestamp: "2026-11-06T10:30:00Z" };

  it("emits a record per ingested event, with the event's own timestamp", async () => {
    const recs = await collect("runtime_gateway", {}, ctx({ loadRuntimeEvents: async () => [{ eventId: "evt_001", payload: ev, receivedAt: NOW }] }));
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ externalRecordId: "evt_001", sourceReference: "evt:evt_001" });
    expect(recs[0].observedAt.toISOString()).toBe("2026-11-06T10:30:00.000Z");
  });

  it("yields nothing without events, and rejects invalid ones", async () => {
    expect(await collect("runtime_gateway", {})).toEqual([]);
    const recs = await collect("runtime_gateway", {}, ctx({ loadRuntimeEvents: async () => [{ eventId: "bad", payload: { eventId: "bad" }, receivedAt: NOW }] }));
    expect(recs[0].rejected).toBe(true);
  });

  it("validates events", () => {
    expect(validateRuntimeEvent(ev)).toBeNull();
    for (const bad of [null, {}, { ...ev, eventId: "has space" }, { ...ev, outcome: "maybe" }, { ...ev, timestamp: "yesterday" }, { ...ev, sourceAgent: "" }, { ...ev, operation: "" }]) {
      expect(validateRuntimeEvent(bad), JSON.stringify(bad)).toEqual(expect.any(String));
    }
  });
});

describe("normalization (explicit mapping rules)", () => {
  const rec = (payload: Record<string, unknown>) => ({ externalRecordId: "r", sourceReference: "r", payload, observedAt: NOW });

  it("maps configuration tools to operational 'invokes' or resource 'accesses', as 'configured'", () => {
    const a = normalize("agent_configuration", rec({ agent: "support-agent", tool: { name: "payment-service", targetAgent: "payment-agent", operation: "request_payment" } }));
    expect(a).toMatchObject({ ok: true, observation: { dependencyType: "operational", relationship: "invokes", evidenceKind: "configured", sourceEntity: { type: "agent", reference: "support-agent" }, targetEntity: { type: "agent", reference: "payment-agent" } } });
    const r = normalize("agent_configuration", rec({ agent: "support-agent", tool: { name: "customer-api", resourceType: "api", accessLevel: "read", externalReference: "customer-api-prod" } }));
    expect(r).toMatchObject({ ok: true, observation: { dependencyType: "resource", relationship: "accesses", metadata: { accessLevel: "read" }, targetEntity: { type: "resource", reference: "customer-api-prod" } } });
  });

  it("never invents an access level and rejects unsupported ones", () => {
    const none = normalize("agent_configuration", rec({ agent: "a", tool: { name: "api", resourceType: "api" } }));
    expect(none).toMatchObject({ ok: true, observation: { metadata: {} } });
    expect(normalize("agent_configuration", rec({ agent: "a", tool: { name: "api", resourceType: "api", accessLevel: "root" } }))).toEqual({ ok: false, reason: 'Unsupported accessLevel "root"' });
  });

  it("no source ever produces an authority dependency", () => {
    const outputs = [
      normalize("agent_configuration", rec({ agent: "a", tool: { name: "t", targetAgent: "b" } })),
      normalize("workflow_definition", rec({ workflowId: "w", from: { agent: "a" }, to: { agent: "b" }, index: 0 })),
      normalize("runtime_gateway", rec({ eventId: "e", sourceAgent: "a", targetAgent: "b", outcome: "completed" })),
    ];
    for (const o of outputs) expect(o.ok && o.observation.dependencyType).not.toBe("authority");
  });

  it("maps workflows to 'declared' and events to 'observed' with their outcome", () => {
    expect(normalize("workflow_definition", rec({ workflowId: "w", from: { agent: "a" }, to: { agent: "b", operation: "x" }, index: 0 }))).toMatchObject({ ok: true, observation: { relationship: "triggers", evidenceKind: "declared", evidence: { reference: "workflow:w", operation: "x" } } });
    expect(normalize("runtime_gateway", rec({ eventId: "e1", sourceAgent: "a", targetAgent: "b", outcome: "denied", operation: "pay" }))).toMatchObject({ ok: true, observation: { relationship: "calls", evidenceKind: "observed", outcome: "denied", evidence: { reference: "event:e1" } } });
  });

  it("rejects incomplete records with a reason", () => {
    expect(normalize("agent_configuration", rec({}))).toEqual({ ok: false, reason: "Missing agent or tool" });
    expect(normalize("agent_configuration", rec({ agent: "a", tool: { name: "t" } }))).toEqual({ ok: false, reason: "Tool declares neither a target agent nor a resource" });
    expect(normalize("workflow_definition", rec({ from: {}, to: {} }))).toEqual({ ok: false, reason: "Workflow step is missing an agent" });
    expect(normalize("runtime_gateway", rec({ outcome: "allowed" }))).toEqual({ ok: false, reason: "Event is missing sourceAgent or targetAgent" });
  });
});

describe("confidence rules", () => {
  it("follows the documented policy table", () => {
    expect(confidenceFor({ evidenceSourceType: "workflow_definition" }).confidence).toBe(0.95);
    expect(confidenceFor({ evidenceSourceType: "agent_configuration" }).confidence).toBe(0.9);
    expect(confidenceFor({ evidenceSourceType: "runtime_event", outcome: "allowed" }).confidence).toBe(0.85);
    expect(confidenceFor({ evidenceSourceType: "runtime_event", outcome: "completed" }).confidence).toBe(0.85);
    expect(confidenceFor({ evidenceSourceType: "runtime_event", outcome: "attempted" }).confidence).toBe(0.65);
    expect(confidenceFor({ evidenceSourceType: "runtime_event", outcome: "denied" }).confidence).toBe(0.65);
    expect(confidenceFor({ evidenceSourceType: "agent_configuration" }).rule).toBe("Explicit agent configuration");
  });
});

describe("entity resolution", () => {
  const lookup = (m: { ext?: Record<string, string>; ids?: Record<string, string>; names?: Record<string, string> }): EntityLookup => ({
    byExternalReference: async (t, r) => m.ext?.[`${t}:${r.toLowerCase()}`] ?? null,
    byId: async (t, r) => m.ids?.[`${t}:${r.toLowerCase()}`] ?? null,
    byName: async (t, r) => m.names?.[`${t}:${r.toLowerCase()}`] ?? null,
  });

  it("resolves by external reference, then id, then name, and records how", async () => {
    expect(await resolveEntity(lookup({ ext: { "agent:support-agent": "A1" } }), "agent", "support-agent")).toEqual({ status: "resolved", entity: { id: "A1", matchedBy: "external_reference" } });
    const uuid = "11111111-1111-4111-8111-111111111111";
    expect(await resolveEntity(lookup({ ids: { [`agent:${uuid}`]: "A2" } }), "agent", uuid)).toEqual({ status: "resolved", entity: { id: "A2", matchedBy: "id" } });
    expect(await resolveEntity(lookup({ names: { "resource:customer api": "R1" } }), "resource", "Customer API")).toEqual({ status: "resolved", entity: { id: "R1", matchedBy: "name" } });
  });

  it("the same entity found two ways is not ambiguous", async () => {
    expect(await resolveEntity(lookup({ ext: { "agent:x": "A1" }, names: { "agent:x": "A1" } }), "agent", "x")).toMatchObject({ status: "resolved", entity: { id: "A1", matchedBy: "external_reference" } });
  });

  it("different entities through different routes are ambiguous, never guessed", async () => {
    const r = await resolveEntity(lookup({ ext: { "agent:x": "A1" }, names: { "agent:x": "A2" } }), "agent", "x");
    expect(r.status).toBe("ambiguous");
  });

  it("unknown and empty references are unresolved", async () => {
    expect(await resolveEntity(lookup({}), "agent", "ghost")).toMatchObject({ status: "unresolved", reason: expect.stringContaining("No registered agent") });
    expect(await resolveEntity(lookup({}), "agent", "   ")).toMatchObject({ status: "unresolved" });
  });

  it("only matches the expected entity type", async () => {
    expect(await resolveEntity(lookup({ ext: { "resource:x": "R1" } }), "agent", "x")).toMatchObject({ status: "unresolved" });
  });

  it("memoizes lookups per run", async () => {
    let calls = 0;
    const l = memoizeLookup({ byExternalReference: async () => { calls++; return "A"; }, byId: async () => null, byName: async () => null });
    await l.byExternalReference("agent", "x"); await l.byExternalReference("agent", "X");
    expect(calls).toBe(1);
  });
});

describe("reconciliation classification", () => {
  const existing = (over: Partial<ExistingDependency> = {}): ExistingDependency => ({ id: "d", status: "active", relationship: "invokes", metadata: {}, provenanceSource: "discovered", ...over });
  const prop = (over = {}) => ({ relationship: "invokes", metadata: {}, confidence: 0.9, ...over });

  it("new: auto-applies at or above the threshold, otherwise needs review", () => {
    expect(classify(null, prop())).toMatchObject({ outcome: "new", autoApply: true });
    expect(classify(null, prop({ confidence: 0.8 }))).toMatchObject({ outcome: "new", autoApply: true });
    expect(classify(null, prop({ confidence: 0.65 }))).toMatchObject({ outcome: "new", autoApply: false });
  });

  it("unchanged: matches an active dependency and may always append evidence", () => {
    expect(classify(existing(), prop({ confidence: 0.1 }))).toMatchObject({ outcome: "unchanged", autoApply: true });
    expect(classify(existing({ metadata: { accessLevel: "read", extra: 1 } }), prop({ metadata: { accessLevel: "read" } }))).toMatchObject({ outcome: "unchanged" });
  });

  it("modified: metadata the source states differs from a discovered dependency", () => {
    expect(classify(existing({ metadata: { accessLevel: "unknown" } }), prop({ metadata: { accessLevel: "write" } }))).toMatchObject({ outcome: "modified", autoApply: true });
    expect(classify(existing({ metadata: { accessLevel: "unknown" } }), prop({ metadata: { accessLevel: "write" }, confidence: 0.6 }))).toMatchObject({ outcome: "modified", autoApply: false });
  });

  it("the relationship label is not compared: different sources name the same dependency differently", () => {
    expect(classify(existing(), prop({ relationship: "triggers" }))).toMatchObject({ outcome: "unchanged", autoApply: true });
    expect(classify(existing({ provenanceSource: "manual" }), prop({ relationship: "calls" }))).toMatchObject({ outcome: "unchanged" });
  });

  it("conflicting: a manual dependency is never overwritten, and an inactive one is never resurrected", () => {
    expect(classify(existing({ provenanceSource: "manual", metadata: { accessLevel: "read" } }), prop({ metadata: { accessLevel: "write" } }))).toMatchObject({ outcome: "conflicting", autoApply: false });
    expect(classify(existing({ status: "inactive" }), prop())).toMatchObject({ outcome: "conflicting", autoApply: false });
    // manual but equal: just evidence
    expect(classify(existing({ provenanceSource: "manual" }), prop())).toMatchObject({ outcome: "unchanged" });
  });

  it("a source silent about a metadata key never overwrites it", () => {
    expect(metadataDiffers({ accessLevel: "write" }, {})).toBe(false);
    expect(metadataDiffers({ accessLevel: "write" }, { accessLevel: "read" })).toBe(true);
  });

  it("intra-run conflicts: sources that state different values for the same key of the same dependency", () => {
    const items = [
      { key: "a>b|resource", observationId: "o1", relationship: "accesses", metadata: { accessLevel: "read" }, confidence: 0.9 },
      { key: "a>b|resource", observationId: "o2", relationship: "accesses", metadata: { accessLevel: "write" }, confidence: 0.9 },
      { key: "c>d|operational", observationId: "o3", relationship: "invokes", metadata: {}, confidence: 0.9 },
      { key: "c>d|operational", observationId: "o4", relationship: "triggers", metadata: {}, confidence: 0.95 },
      { key: "e>f|resource", observationId: "o5", relationship: "accesses", metadata: {}, confidence: 0.9 },
      { key: "e>f|resource", observationId: "o6", relationship: "accesses", metadata: { accessLevel: "read" }, confidence: 0.9 },
    ];
    expect([...findIntraRunConflicts(items)].sort()).toEqual(["o1", "o2"]);
  });
});

describe("redaction of raw evidence", () => {
  it("redacts secret-looking keys at any depth and truncates long strings", () => {
    const r = redact({ agent: "a", token: "abc", nested: { apiKey: "k", ok: 1 }, list: [{ password: "p" }], long: "x".repeat(2000) }) as any;
    expect(r.token).toBe("[redacted]");
    expect(r.nested).toEqual({ apiKey: "[redacted]", ok: 1 });
    expect(r.list[0].password).toBe("[redacted]");
    expect(r.long.length).toBeLessThan(1100);
    expect(r.agent).toBe("a");
  });
  it("replaces oversized payloads with a marker", () => {
    expect(redactPayload({ big: Array.from({ length: 200 }, () => "y".repeat(900)) })).toEqual({ truncated: true });
    expect(redactPayload({ small: 1 })).toEqual({ small: 1 });
  });
});
