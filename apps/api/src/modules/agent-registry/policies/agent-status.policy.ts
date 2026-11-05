import type { Permission } from "../../../auth/permissions.js";
import { InvalidStatusTransitionError } from "../../../errors.js";
import type { AgentStatus } from "../types/agent.types.js";

/**
 * Centralised lifecycle policy. This is the only place that decides which
 * status transitions exist.
 *
 * - "ordinary" transitions need `agent:status` (admin, operator).
 * - "recovery" transitions need `agent:recover` (admin only) and a substantive
 *   reason. EVERY exit from `compromised` is a recovery transition, so a
 *   compromised agent cannot be laundered back to `active` via
 *   `compromised -> inactive -> active` by a non-admin.
 */
export type TransitionKind = "ordinary" | "recovery";

const TRANSITIONS: Record<AgentStatus, Partial<Record<AgentStatus, TransitionKind>>> = {
  active: { suspended: "ordinary", compromised: "ordinary", inactive: "ordinary" },
  suspended: { active: "ordinary", compromised: "ordinary", inactive: "ordinary" },
  compromised: { suspended: "recovery", active: "recovery", inactive: "recovery" },
  inactive: { active: "ordinary", compromised: "ordinary" },
};

export const MIN_RECOVERY_REASON_LENGTH = 10;

export function transitionKind(from: AgentStatus, to: AgentStatus): TransitionKind {
  if (from === to) {
    throw new InvalidStatusTransitionError(`Agent is already ${from}`, { from, to });
  }
  const kind = TRANSITIONS[from][to];
  if (!kind) {
    throw new InvalidStatusTransitionError(`Transition from ${from} to ${to} is not permitted`, { from, to });
  }
  return kind;
}

export function permissionForTransition(kind: TransitionKind): Permission {
  return kind === "recovery" ? "agent:recover" : "agent:status";
}

export function validateReason(kind: TransitionKind, reason: string): void {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new InvalidStatusTransitionError("A reason is required for every status change");
  }
  if (kind === "recovery" && trimmed.length < MIN_RECOVERY_REASON_LENGTH) {
    throw new InvalidStatusTransitionError(
      `A recovery requires a reason of at least ${MIN_RECOVERY_REASON_LENGTH} characters`,
    );
  }
}

/** Registration policy: new agents always start `active`; callers cannot choose. */
export function initialStatus(): AgentStatus {
  return "active";
}
