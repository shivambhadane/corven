import { AppError, ConflictError, NotFoundError, UnprocessableError } from "../../errors.js";
const withCode = <T extends AppError>(e: T, code: string): T => {
  (e as { code: string }).code = code;
  return e;
};
export const runNotFound = () => withCode(new NotFoundError("Verification run not found"), "VERIFICATION_NOT_FOUND");
export const incidentNotFound = () => withCode(new NotFoundError("Incident not found"), "INCIDENT_NOT_FOUND");
export const notVerifiable = (status: string) => new ConflictError(`Verification runs only for an incident in containing or verifying (it is ${status})`, "INCIDENT_NOT_VERIFIABLE");
export const inProgress = () => new ConflictError("A verification run is already in progress for this incident", "VERIFICATION_IN_PROGRESS");
export const noApprovedPlan = () => new UnprocessableError("NO_APPROVED_PLAN", "The incident has no approved containment plan to verify");
export const notRetryable = (why: string) => new ConflictError(why, "VERIFICATION_NOT_RETRYABLE");
export const retryLimit = () => new ConflictError("The retry limit for this verification has been reached", "RETRY_LIMIT_REACHED");
export const badTarget = (why: string) => withCode(new NotFoundError(why), "TARGET_NOT_FOUND");
