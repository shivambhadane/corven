import type { ActorType, IncidentStatus } from "../types.js";

/**
 * The incident lifecycle. Pure and independent of the database so it can be
 * tested exhaustively. Every transition names WHO may make it:
 *
 *  - "human"  an authenticated person (admin or operator)
 *  - "system" a trusted internal module (approval, gateway, verification)
 *
 * Transitions that assert facts only another module can establish (approved,
 * containing, verifying, contained, partially_contained, containment_failed) are
 * system-only, so no person can mark an incident contained by hand.
 * `recovery` edges reopen finished work and need the incident:recover permission.
 */
export type Guard =
  /** A containment plan generated in the current state, on the current snapshot, must exist. */
  | "fresh_plan"
  /** The current plan must be feasible (infeasible and no-action plans cannot be sent for approval). */
  | "feasible_plan"
  /** The caller must acknowledge residual risk explicitly. */
  | "residual_risk_acknowledged";

export interface Edge {
  to: IncidentStatus;
  actors: readonly ActorType[];
  recovery?: true;
  guards?: readonly Guard[];
}

const H = ["human"] as const;
const S = ["system"] as const;
const HS = ["human", "system"] as const;

export const TRANSITIONS: Readonly<Record<IncidentStatus, readonly Edge[]>> = {
  detected: [{ to: "investigating", actors: HS }, { to: "false_positive", actors: H }],
  investigating: [{ to: "containment_planned", actors: HS, guards: ["fresh_plan"] }, { to: "false_positive", actors: H }],
  containment_planned: [
    { to: "awaiting_approval", actors: HS, guards: ["feasible_plan"] },
    { to: "investigating", actors: H },
    { to: "false_positive", actors: H },
  ],
  awaiting_approval: [{ to: "approved", actors: S }, { to: "rejected", actors: S }, { to: "investigating", actors: HS }],
  rejected: [
    { to: "containment_planned", actors: HS, guards: ["fresh_plan"] },
    { to: "investigating", actors: H },
    { to: "false_positive", actors: H },
  ],
  approved: [{ to: "containing", actors: S }, { to: "investigating", actors: HS }],
  containing: [{ to: "verifying", actors: S }, { to: "partially_contained", actors: S }, { to: "containment_failed", actors: S }],
  verifying: [{ to: "contained", actors: S }, { to: "partially_contained", actors: S }, { to: "containment_failed", actors: S }],
  contained: [{ to: "resolved", actors: H }, { to: "investigating", actors: H, recovery: true }],
  partially_contained: [
    { to: "containment_planned", actors: HS, guards: ["fresh_plan"] },
    { to: "resolved", actors: H, guards: ["residual_risk_acknowledged"] },
  ],
  containment_failed: [{ to: "containment_planned", actors: HS, guards: ["fresh_plan"] }, { to: "investigating", actors: H }],
  false_positive: [{ to: "closed", actors: H }, { to: "investigating", actors: H, recovery: true }],
  resolved: [{ to: "closed", actors: H }, { to: "investigating", actors: H, recovery: true }],
  closed: [{ to: "investigating", actors: H, recovery: true }],
};

/** States in which analysis (snapshot, blast radius) may still be attached. */
export const ANALYSIS_STATES: ReadonlySet<IncidentStatus> = new Set(["detected", "investigating", "containment_planned", "rejected", "partially_contained", "containment_failed"]);
/** States in which a containment plan may be generated. A plan under approval or execution is locked. */
export const PLAN_STATES: ReadonlySet<IncidentStatus> = new Set(["investigating", "containment_planned", "rejected", "partially_contained", "containment_failed"]);

export const edgeFor = (from: IncidentStatus, to: IncidentStatus): Edge | undefined => TRANSITIONS[from].find((e) => e.to === to);
export const allowedFrom = (from: IncidentStatus): readonly Edge[] => TRANSITIONS[from];
