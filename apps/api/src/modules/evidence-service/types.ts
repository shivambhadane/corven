export const EVIDENCE_SCHEMA_VERSION = 1;
export const EVIDENCE_STATUSES = ["sealed", "anchor_pending", "anchored", "anchor_failed", "verified", "invalid"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];
export type AnchorTarget = "arkiv" | "ethereum";
export type AnchorStatus = "submitted" | "confirmed" | "failed";

/** What leaves CORVEN when evidence is anchored: identifiers and the hash, never the content. */
export interface AnchorPayload {
  evidenceId: string;
  contentHash: string;
  schemaVersion: number;
  sequence: number;
}

export interface RequestMeta {
  correlationId?: string | undefined;
}
