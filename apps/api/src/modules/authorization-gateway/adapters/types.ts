import type { Principal } from "../../../auth/principal.js";
import type { ActionKind } from "../types.js";

export interface AdapterContext {
  organizationId: string;
  actionId: string;
  kind: ActionKind;
  agentId: string | null;
  resourceId: string | null;
  reason: string;
  incidentId: string | null;
  /** Who asked. Adapters act with this identity's authority, never with more. */
  principal: Principal;
}

/**
 * What an adapter reports. `executed` means the state CORVEN controls changed.
 * It never means "the compromised agent can no longer do the thing": that is
 * established by Verification, which is why `verificationRequired` is part of
 * every result.
 */
export interface AdapterResult {
  status: "executed" | "submitted" | "failed";
  detail: Record<string, unknown>;
  failureReason?: string;
  externalReference?: string;
  verificationRequired: string[];
  observedAt: string;
}

export interface EnforcementAdapter {
  readonly name: string;
  supports(kind: ActionKind): boolean;
  /** Which control class this adapter provides for an action it supports. */
  readonly coverage: "CONTROLLED_LOCAL";
  apply(ctx: AdapterContext): Promise<AdapterResult>;
  /** Undo the restriction where that is possible. Not every adapter can. */
  rollback(ctx: AdapterContext): Promise<AdapterResult>;
  supportsRollback(kind: ActionKind): boolean;
}

export const result = (status: AdapterResult["status"], detail: Record<string, unknown>, verificationRequired: string[], extra: Partial<AdapterResult> = {}): AdapterResult => ({
  status, detail, verificationRequired, observedAt: new Date().toISOString(), ...extra,
});
