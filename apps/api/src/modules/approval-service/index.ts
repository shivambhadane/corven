import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/client.js";
import type { createIncidentManagement } from "../incident-management/index.js";
import { ApprovalRepository } from "./repositories/approval.repository.js";
import { approvalRoutes } from "./routes/approval.routes.js";
import { ApprovalService } from "./services/approval.service.js";

export function createApprovalService(db: Database, incidents: ReturnType<typeof createIncidentManagement>, now?: () => Date, repo: ApprovalRepository = new ApprovalRepository()) {
  return { repo, approvals: new ApprovalService(db, repo, incidents.incidents, incidents.reader, incidents.analysis, now) };
}

export async function registerApprovalService(app: FastifyInstance, a: ReturnType<typeof createApprovalService>) {
  await app.register(approvalRoutes, { prefix: "/api/v1", approvals: a.approvals });
}

export { approvalDigest, assessRisk, requiredFor, validatePolicy } from "./core/binding.js";
export * from "./types.js";
