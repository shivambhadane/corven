import type { DiscoverySourceType, RawDiscoveryRecord } from "../types.js";

/**
 * Source adapters only COLLECT. They read what a source says and emit one raw
 * record per candidate relationship. They resolve no entity, assign no id and
 * write nothing: normalization, resolution and the registry boundary come later.
 *
 * Config and workflow documents are stored in the discovery source itself (never
 * read from disk or fetched from a URL), so there is no path traversal or
 * server-side request surface.
 */
export interface DocumentSourceConfig {
  documents: Array<{ id: string; content: unknown }>;
}

export interface DiscoveryContext {
  organizationId: string;
  discoveryRunId: string;
  sourceId: string;
  now: Date;
  /** Runtime events ingested for this source and not yet consumed (or consumed by this run, for retries). */
  loadRuntimeEvents?: () => Promise<Array<{ eventId: string; payload: Record<string, unknown>; receivedAt: Date }>>;
}

export interface DiscoveryAdapter {
  readonly type: DiscoverySourceType;
  validateConfiguration(configuration: Record<string, unknown>): void;
  discover(config: Record<string, unknown>, ctx: DiscoveryContext): AsyncIterable<RawDiscoveryRecord | RejectedRecord>;
}

/** A document or event that could not be parsed. It is stored as a rejected observation with the reason. */
export interface RejectedRecord {
  rejected: true;
  externalRecordId: string;
  sourceReference: string;
  reason: string;
  payload: Record<string, unknown>;
  observedAt: Date;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 255;

export const MAX_DOCUMENTS = 100;
export const MAX_DOCUMENT_BYTES = 64 * 1024;

function validateDocuments(configuration: Record<string, unknown>): DocumentSourceConfig {
  const docs = configuration.documents;
  if (!Array.isArray(docs)) throw new Error("configuration.documents must be an array");
  if (docs.length > MAX_DOCUMENTS) throw new Error(`At most ${MAX_DOCUMENTS} documents per source`);
  const ids = new Set<string>();
  for (const d of docs) {
    if (!isObj(d) || !isStr(d.id) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(d.id as string)) throw new Error("Each document needs an id of letters, digits and ._:- (max 100)");
    if (ids.has(d.id as string)) throw new Error(`Duplicate document id "${d.id}"`);
    ids.add(d.id as string);
    if (Buffer.byteLength(JSON.stringify(d.content ?? null), "utf8") > MAX_DOCUMENT_BYTES) throw new Error(`Document "${d.id}" exceeds ${MAX_DOCUMENT_BYTES} bytes`);
  }
  return { documents: docs as DocumentSourceConfig["documents"] };
}

// ---------------------------------------------------------------- agent configuration

/**
 * Document: { "agent": "support-agent", "tools": [ { "name": "payment-service", "targetAgent": "payment-agent", "operation": "request_payment" },
 *                                                    { "name": "customer-api", "resourceType": "api", "accessLevel": "read" } ] }
 * A tool is a DECLARATION. It is not proof of use, and it never implies authority.
 */
export const agentConfigurationAdapter: DiscoveryAdapter = {
  type: "agent_configuration",
  validateConfiguration: (c) => void validateDocuments(c),
  async *discover(config, ctx) {
    const { documents } = validateDocuments(config);
    for (const doc of documents) {
      const content = doc.content;
      if (!isObj(content) || !isStr(content.agent) || !Array.isArray(content.tools)) {
        yield rejected(doc.id, `${doc.id}#invalid`, "Configuration must be an object with an agent and a tools array", content, ctx.now);
        continue;
      }
      for (const [i, tool] of (content.tools as unknown[]).entries()) {
        const ref = `${doc.id}#${content.agent}->${isObj(tool) && isStr(tool.name) ? tool.name : `tool${i}`}`;
        if (!isObj(tool) || !isStr(tool.name)) { yield rejected(doc.id, ref, "Tool needs a name", { agent: content.agent }, ctx.now); continue; }
        const hasTarget = isStr(tool.targetAgent), hasResource = isStr(tool.resourceType);
        if (hasTarget === hasResource) { yield rejected(doc.id, ref, "Tool must declare exactly one of targetAgent or resourceType", { agent: content.agent, tool: tool.name }, ctx.now); continue; }
        yield { externalRecordId: ref, sourceReference: ref, payload: { agent: content.agent, tool }, observedAt: ctx.now };
      }
    }
  },
};

// ---------------------------------------------------------------- workflow definition

/**
 * Document: { "workflowId": "payment-flow", "steps": [ { "agent": "support-agent", "operation": "request_payment" }, ... ] }
 * Consecutive steps give an OPERATIONAL candidate (step i triggers step i+1). Sequence alone
 * never proves authority delegation, so no authority candidate is ever produced here.
 */
export const workflowDefinitionAdapter: DiscoveryAdapter = {
  type: "workflow_definition",
  validateConfiguration: (c) => void validateDocuments(c),
  async *discover(config, ctx) {
    const { documents } = validateDocuments(config);
    for (const doc of documents) {
      const c = doc.content;
      if (!isObj(c) || !isStr(c.workflowId) || !Array.isArray(c.steps)) {
        yield rejected(doc.id, `${doc.id}#invalid`, "Workflow must be an object with a workflowId and a steps array", c, ctx.now);
        continue;
      }
      const steps = c.steps as unknown[];
      if (steps.length < 2) { yield rejected(doc.id, `${doc.id}#too-short`, "A workflow needs at least two steps to describe a dependency", { workflowId: c.workflowId }, ctx.now); continue; }
      for (let i = 0; i < steps.length - 1; i++) {
        const from = steps[i], to = steps[i + 1];
        const ref = `${c.workflowId}#${i}`;
        if (!isObj(from) || !isStr(from.agent) || !isObj(to) || !isStr(to.agent)) { yield rejected(doc.id, ref, "Every step needs an agent", { workflowId: c.workflowId, index: i }, ctx.now); continue; }
        yield { externalRecordId: ref, sourceReference: ref, payload: { workflowId: c.workflowId, from, to, index: i }, observedAt: ctx.now };
      }
    }
  },
};

// ---------------------------------------------------------------- runtime gateway events

export const RUNTIME_OUTCOMES = ["attempted", "allowed", "denied", "completed"] as const;

/** Validates one gateway event. Shared by the ingestion endpoint and the adapter. */
export function validateRuntimeEvent(e: unknown): string | null {
  if (!isObj(e)) return "Event must be an object";
  if (!isStr(e.eventId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(e.eventId as string)) return "eventId is required (letters, digits and ._:-)";
  if (!isStr(e.sourceAgent) || !isStr(e.targetAgent)) return "sourceAgent and targetAgent are required";
  if (!(RUNTIME_OUTCOMES as readonly string[]).includes(e.outcome as string)) return `outcome must be one of ${RUNTIME_OUTCOMES.join(", ")}`;
  if (typeof e.timestamp !== "string" || Number.isNaN(Date.parse(e.timestamp))) return "timestamp must be an ISO date";
  if (e.operation !== undefined && !isStr(e.operation)) return "operation must be a non-empty string";
  return null;
}

/**
 * Events come from CORVEN-controlled boundaries. An event shows an interaction was
 * ATTEMPTED, ALLOWED, DENIED or COMPLETED at that boundary; it does not prove a
 * standing authority relationship.
 */
export const runtimeGatewayAdapter: DiscoveryAdapter = {
  type: "runtime_gateway",
  validateConfiguration: () => undefined,
  async *discover(_config, ctx) {
    const events = ctx.loadRuntimeEvents ? await ctx.loadRuntimeEvents() : [];
    for (const ev of events) {
      const err = validateRuntimeEvent(ev.payload);
      const ref = `evt:${ev.eventId}`;
      if (err) { yield rejected(ev.eventId, ref, err, { eventId: ev.eventId }, ctx.now); continue; }
      yield { externalRecordId: ev.eventId, sourceReference: ref, payload: ev.payload, observedAt: new Date(ev.payload.timestamp as string) };
    }
  },
};

function rejected(docId: string, externalRecordId: string, reason: string, payload: unknown, now: Date): RejectedRecord {
  return { rejected: true, externalRecordId, sourceReference: externalRecordId, reason, payload: isObj(payload) ? payload : { documentId: docId }, observedAt: now };
}

export const ADAPTERS: Record<DiscoverySourceType, DiscoveryAdapter> = {
  agent_configuration: agentConfigurationAdapter,
  workflow_definition: workflowDefinitionAdapter,
  runtime_gateway: runtimeGatewayAdapter,
};
