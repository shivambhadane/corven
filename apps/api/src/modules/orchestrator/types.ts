export const WORKFLOW_STATUSES = ["running", "waiting", "completed", "stopped", "blocked", "failed", "cancelled"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];
export const TERMINAL: ReadonlySet<WorkflowStatus> = new Set(["completed", "stopped", "blocked", "failed", "cancelled"]);

export type StepResult =
  | { kind: "again"; step: string }
  | { kind: "wait"; step: string; seconds: number }
  | { kind: "done"; outcome: string }
  | { kind: "stopped"; outcome: string }
  | { kind: "blocked"; outcome: string };

export const ORCHESTRATOR_ACTOR_ID = "00000000-0000-4000-8000-0000000c0de0";
export const LEASE_SECONDS = 120;
export const MAX_VERIFICATION_ATTEMPTS = 3;
export const backoffSeconds = (attempt: number) => Math.min(5 * 2 ** (attempt - 1), 300);
