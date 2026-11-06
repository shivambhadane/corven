export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired", "cancelled", "invalidated"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export type Risk = "standard" | "elevated";

export interface ApprovalPolicy {
  requiredApprovals: number;
  /** Used when the plan is elevated risk (the Containment Engine flagged it for approval, or it touches a healthy agent). */
  elevatedRequiredApprovals: number;
  /** When true, the person who requested an approval cannot approve it. */
  separationOfDuties: boolean;
  /** A pending request expires after this. */
  expiryMinutes: number;
  /** An approved plan may be executed only within this window after approval. */
  executionWindowMinutes: number;
}

/** Used when an organization has not set a policy. Conservative on purpose. */
export const DEFAULT_POLICY: ApprovalPolicy = { requiredApprovals: 1, elevatedRequiredApprovals: 2, separationOfDuties: true, expiryMinutes: 60, executionWindowMinutes: 60 };

/** Version of the canonical approval binding. Changing what is hashed requires a new version. */
export const APPROVAL_SCHEMA_VERSION = 1;

export interface RequestMeta {
  correlationId?: string | undefined;
}
