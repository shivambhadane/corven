export const ACTION_KINDS = ["revoke_resource_access", "suspend_agent", "revoke_credentials", "revoke_authority", "block_operational_trigger"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type EnforcementStatus = "pending" | "submitted" | "executed" | "failed" | "unsupported" | "rolled_back";
export type ApprovalBasis = "plan_approval" | "admin_override";
export type ControlClass = "CONTROLLED" | "PARTIALLY_CONTROLLED" | "NOT_CONTROLLED" | "UNKNOWN";
export type EnforcementMode = "gateway" | "advisory";

export interface PermissionConstraints {
  /** Largest allowed value of payload.amount. A request without a numeric amount is denied when this is set. */
  maxAmount?: number;
  /** After this instant the permission no longer allows anything. */
  expiresAt?: string;
}

export interface Permission {
  id: string;
  organizationId: string;
  agentId: string;
  resourceId: string;
  action: string;
  constraints: PermissionConstraints;
  status: "active" | "revoked";
  version: number;
  grantedBy: string;
  createdAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
  revokeReason: string | null;
}

export type ReasonCode =
  | "ALLOWED"
  | "AGENT_NOT_FOUND"
  | "AGENT_NOT_ACTIVE"
  | "CREDENTIAL_INACTIVE"
  | "RESOURCE_UNKNOWN"
  | "NO_PERMISSION"
  | "PERMISSION_EXPIRED"
  | "CONSTRAINT_VIOLATED"
  | "RESTRICTED_BY_CONTAINMENT"
  | "REVOKED_BEFORE_EXECUTION";

export interface Decision {
  decision: "allow" | "deny";
  reasonCodes: ReasonCode[];
  permissionId: string | null;
  permissionVersion: number | null;
}

export interface AuthenticatedAgent {
  agentId: string;
  organizationId: string;
  credentialId: string;
  tokenId: string;
}

export interface RequestMeta {
  correlationId?: string | undefined;
}
