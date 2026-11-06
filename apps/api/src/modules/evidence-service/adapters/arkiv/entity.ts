import { createHash } from "node:crypto";
import { defineSchema, str, u64, type U64Value } from "@arkiv-network/sdk/schema";
import { ArkivError } from "./errors.js";

/**
 * The Arkiv entity for one evidence record. It holds commitments and opaque references only:
 * no incident text, titles, descriptions, comments, payloads, credentials, agent names or graph data.
 *
 *   evidenceRef / incidentRef / orgRef   sha256("corven.<kind>.v1:" + uuid): a reviewer holding the uuid can recompute them,
 *                                         the chain and its readers learn no internal identifier
 *   evidenceHash                          the SHA-256 of CORVEN's canonical evidence document, exactly as sealed
 *   previousHash                          the hash of the previous evidence record of the incident ("" for the first)
 *
 * Indexed columns are the ones queried: evidence, incident and organization references and the hash.
 */
export const EVIDENCE_ENTITY_SCHEMA_NAME = "corven.evidence.v1";

export const EvidenceEntity = defineSchema(EVIDENCE_ENTITY_SCHEMA_NAME, {
  evidenceRef: str().indexed(),
  incidentRef: str().indexed(),
  orgRef: str().indexed(),
  evidenceHash: str().indexed(),
  previousHash: str(),
  schemaVersion: u64(),
  sequence: u64(),
  createdAt: str(),
  contentType: str(),
  producer: str(),
});

export const PRODUCER = "CORVEN";
export const CONTENT_TYPE = "application/json";

export interface ArkivEvidenceInput {
  evidenceId: string;
  incidentId: string;
  organizationId: string;
  contentHash: string;
  previousHash: string | null;
  schemaVersion: number;
  sequence: number;
  /** ISO-8601 time the evidence was sealed. */
  createdAt: string;
}

/** What a stored entity must say, in CORVEN's own terms, for the read-back comparison. */
export type ArkivExpected = ArkivEvidenceInput;

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const refOf = (kind: "evidence" | "incident" | "org", uuid: string): string => createHash("sha256").update(`corven.${kind}.v1:${uuid.toLowerCase()}`).digest("hex");

export interface EntityValues {
  evidenceRef: string; incidentRef: string; orgRef: string; evidenceHash: string; previousHash: string;
  schemaVersion: U64Value; sequence: U64Value; createdAt: string; contentType: string; producer: string;
}

/** Validates and builds the values to store. Anything off throws before a single byte leaves CORVEN. */
export function buildEntityValues(i: ArkivEvidenceInput): EntityValues {
  const bad = (m: string) => new ArkivError("ARKIV_INVALID_ENTITY", m);
  if (!UUID.test(i.evidenceId) || !UUID.test(i.incidentId) || !UUID.test(i.organizationId)) throw bad("References must be uuids");
  const hash = i.contentHash.replace(/^0x/, "").toLowerCase();
  if (!HEX64.test(hash)) throw bad("The evidence hash must be 64 hexadecimal characters (SHA-256)");
  const prev = i.previousHash ? i.previousHash.replace(/^0x/, "").toLowerCase() : "";
  if (i.previousHash && !HEX64.test(prev)) throw bad("The previous hash must be 64 hexadecimal characters");
  if (!Number.isInteger(i.schemaVersion) || i.schemaVersion < 1 || !Number.isInteger(i.sequence) || i.sequence < 1) throw bad("Schema version and sequence must be positive integers");
  if (Number.isNaN(Date.parse(i.createdAt))) throw bad("createdAt must be an ISO-8601 time");
  return {
    evidenceRef: refOf("evidence", i.evidenceId), incidentRef: refOf("incident", i.incidentId), orgRef: refOf("org", i.organizationId), evidenceHash: hash, previousHash: prev,
    schemaVersion: u64(BigInt(i.schemaVersion)), sequence: u64(BigInt(i.sequence)), createdAt: new Date(i.createdAt).toISOString(), contentType: CONTENT_TYPE, producer: PRODUCER,
  };
}

export type ReadBack = { outcome: "match" } | { outcome: "mismatch"; field: string } | { outcome: "malformed"; field: string };

const attr = (row: Record<string, unknown>, name: string): unknown => {
  const v = row[name];
  return v && typeof v === "object" && "value" in (v as object) ? (v as { value: unknown }).value : v;
};

/**
 * Validates an entity read from the network and compares it with what CORVEN expects. Data on the network is untrusted:
 * every field is type-checked, the hash comparison is constant-time, and nothing is "close enough".
 */
export function compareEntity(row: Record<string, unknown>, expected: ArkivExpected): ReadBack {
  const want = buildEntityValues(expected);
  const text = (name: string): string | null => {
    const v = attr(row, name);
    return typeof v === "string" ? v : null;
  };
  const big = (name: string): bigint | null => {
    const v = attr(row, name);
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
    return null;
  };
  for (const f of ["evidenceRef", "incidentRef", "orgRef", "evidenceHash", "previousHash", "createdAt", "contentType", "producer"] as const) if (text(f) === null) return { outcome: "malformed", field: f };
  for (const f of ["schemaVersion", "sequence"] as const) if (big(f) === null) return { outcome: "malformed", field: f };
  if (!HEX64.test(text("evidenceHash")!)) return { outcome: "malformed", field: "evidenceHash" };
  if (!constantTimeEqual(text("evidenceHash")!, want.evidenceHash)) return { outcome: "mismatch", field: "evidenceHash" };
  if (text("evidenceRef") !== want.evidenceRef) return { outcome: "mismatch", field: "evidenceRef" };
  if (text("incidentRef") !== want.incidentRef) return { outcome: "mismatch", field: "incidentRef" };
  if (text("orgRef") !== want.orgRef) return { outcome: "mismatch", field: "orgRef" };
  if (text("previousHash") !== want.previousHash) return { outcome: "mismatch", field: "previousHash" };
  if (big("schemaVersion") !== BigInt(expected.schemaVersion)) return { outcome: "mismatch", field: "schemaVersion" };
  if (big("sequence") !== BigInt(expected.sequence)) return { outcome: "mismatch", field: "sequence" };
  if (text("producer") !== PRODUCER) return { outcome: "mismatch", field: "producer" };
  return { outcome: "match" };
}

/** Compares two equal-length strings without an early exit on the first differing character. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
