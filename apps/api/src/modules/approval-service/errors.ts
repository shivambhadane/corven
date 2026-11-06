import { AppError, ConflictError, ForbiddenError, NotFoundError, UnprocessableError } from "../../errors.js";

const withCode = <T extends AppError>(e: T, code: string): T => {
  (e as { code: string }).code = code;
  return e;
};
export const approvalNotFound = () => withCode(new NotFoundError("Approval request not found"), "APPROVAL_NOT_FOUND");
export const incidentNotFound = () => withCode(new NotFoundError("Incident not found"), "INCIDENT_NOT_FOUND");
export const incidentNotReady = (status: string) => new ConflictError(`Approval can be requested only for an incident in containment_planned (it is ${status})`, "INCIDENT_NOT_READY");
export const planRequired = () => new UnprocessableError("CONTAINMENT_PLAN_REQUIRED", "The incident has no current containment plan");
export const planNotFeasible = (s: string | null) => new UnprocessableError("PLAN_NOT_FEASIBLE", `Only a feasible plan can be approved (status: ${s ?? "none"})`);
export const planIntegrityFailed = (why: string) => new ConflictError(`The plan cannot be approved: ${why}`, "PLAN_INTEGRITY_FAILED");
export const approvalPending = () => new ConflictError("The incident already has a pending approval request", "APPROVAL_PENDING");
export const notPending = (status: string) => new ConflictError(`The approval request is ${status}, not pending`, "APPROVAL_NOT_PENDING");
export const approvalExpired = () => new ConflictError("The approval request expired before this decision", "APPROVAL_EXPIRED");
export const approvalInvalidated = (why: string) => new ConflictError(`The approval request was invalidated: ${why}`, "APPROVAL_INVALIDATED");
export const alreadyDecided = () => new ConflictError("You already decided this approval request", "ALREADY_DECIDED");
export const separationOfDuties = () => withCode(new ForbiddenError("Separation of duties: the person who requested an approval cannot approve it"), "SEPARATION_OF_DUTIES");
export const notRequester = () => withCode(new ForbiddenError("Only the requester or an administrator can cancel an approval request"), "FORBIDDEN");
