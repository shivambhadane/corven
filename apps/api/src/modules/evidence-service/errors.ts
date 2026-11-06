import { AppError, ConflictError, NotFoundError } from "../../errors.js";
const withCode = <T extends AppError>(e: T, code: string): T => {
  (e as { code: string }).code = code;
  return e;
};
export const evidenceNotFound = () => withCode(new NotFoundError("Evidence record not found"), "EVIDENCE_NOT_FOUND");
export const incidentNotFound = () => withCode(new NotFoundError("Incident not found"), "INCIDENT_NOT_FOUND");
export const evidenceInvalid = () => new ConflictError("The evidence record failed integrity verification and cannot be anchored", "EVIDENCE_INVALID");
export const targetNotConfigured = (t: string) => new ConflictError(`No ${t} client is configured`, "TARGET_NOT_CONFIGURED");
export const sequenceConflict = () => new ConflictError("Evidence generation conflicted with another generation; retry", "EVIDENCE_GENERATION_CONFLICT");
