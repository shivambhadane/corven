import { AppError, ConflictError, ForbiddenError, NotFoundError, UnprocessableError } from "../../errors.js";

const withCode = <T extends AppError>(e: T, code: string): T => {
  (e as { code: string }).code = code;
  return e;
};

/** One generic failure for every way a credential or token can be wrong, so callers learn nothing about which part failed. */
export class InvalidCredentialError extends AppError {
  constructor() {
    super(401, "INVALID_CREDENTIAL", "The credential is invalid, expired or revoked");
  }
}
export class InvalidTokenError extends AppError {
  constructor() {
    super(401, "INVALID_TOKEN", "The token is invalid, expired or revoked");
  }
}
/** The gateway cannot decide safely, so it denies. */
export class EnforcementUnavailableError extends AppError {
  constructor(message = "The gateway cannot evaluate this request right now and has denied it") {
    super(503, "ENFORCEMENT_UNAVAILABLE", message);
  }
}
export class AgentAuthUnavailableError extends AppError {
  constructor() {
    super(503, "AGENT_AUTH_UNAVAILABLE", "Agent authentication is not configured");
  }
}
export class OperationDeniedError extends AppError {
  constructor(details: unknown) {
    super(403, "OPERATION_DENIED", "The operation was denied", details);
  }
}
export class ExecutionFailedError extends AppError {
  constructor(details: unknown) {
    super(502, "EXECUTION_FAILED", "The operation was authorized but did not execute", details);
  }
}
export const executionInProgress = () => new ConflictError("This request id is already being processed or its outcome is unknown; it will not be executed again", "EXECUTION_IN_PROGRESS");
export const approvalRequired = (why: string) => withCode(new ForbiddenError(why), "APPROVAL_REQUIRED");
export const notFound = (what: string, code: string) => withCode(new NotFoundError(`${what} not found`), code);
export const credentialExists = () => new ConflictError("The agent already has an active credential; rotate it instead", "CREDENTIAL_EXISTS");
export const noActiveCredential = () => withCode(new NotFoundError("The agent has no active credential"), "NO_ACTIVE_CREDENTIAL");
export const permissionExists = () => new ConflictError("An active permission already exists for this agent, resource and action", "PERMISSION_EXISTS");
export const alreadyRevoked = () => new ConflictError("Already revoked", "ALREADY_REVOKED");
export const rollbackNotSupported = (why: string) => new ConflictError(why, "ROLLBACK_NOT_SUPPORTED");
export const invalidTarget = (why: string) => new UnprocessableError("INVALID_ENFORCEMENT_TARGET", why);
