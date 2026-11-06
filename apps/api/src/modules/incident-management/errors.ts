import { AppError, ConflictError, NotFoundError, UnprocessableError } from "../../errors.js";

const withCode = <T extends AppError>(e: T, code: string): T => {
  (e as { code: string }).code = code;
  return e;
};

export const incidentNotFound = () => withCode(new NotFoundError("Incident not found"), "INCIDENT_NOT_FOUND");
export const agentNotFound = () => withCode(new NotFoundError("Agent not found"), "AGENT_NOT_FOUND");
export const resourceNotFound = () => withCode(new NotFoundError("Resource not found"), "RESOURCE_NOT_FOUND");
export const referenceNotFound = () => withCode(new NotFoundError("Analysis reference not found"), "REFERENCE_NOT_FOUND");

export class InvalidIncidentTransitionError extends AppError {
  constructor(from: string, to: string, allowed: string[]) {
    super(409, "INVALID_INCIDENT_TRANSITION", `An incident cannot move from ${from} to ${to}`, { from, to, allowed });
  }
}
export class TransitionNotPermittedError extends AppError {
  constructor(message: string) {
    super(403, "TRANSITION_NOT_PERMITTED", message);
  }
}
export const incidentClosed = () => new ConflictError("The incident is closed; reopen it to change it", "INCIDENT_CLOSED");
export const staleState = (expected: string, actual: string) => new ConflictError(`The incident is ${actual}, not ${expected}`, "STALE_INCIDENT_STATE");
export const alreadyAssociated = () => new ConflictError("This entity is already associated with the incident under that relationship", "ALREADY_ASSOCIATED");
export const idempotencyConflict = () => new ConflictError("That idempotency key was already used for a different request", "IDEMPOTENCY_CONFLICT");
export const analysisNotAllowed = (status: string) => new ConflictError(`Analysis cannot be attached while the incident is ${status}`, "ANALYSIS_NOT_ALLOWED");
export const planLocked = (status: string) => new ConflictError(`A containment plan cannot be generated while the incident is ${status}`, "PLAN_LOCKED");
export const snapshotRequired = () => new ConflictError("Attach a graph snapshot to the incident first", "SNAPSHOT_REQUIRED");
export const guardFailed = (code: string, message: string) => new UnprocessableError(code, message);
