import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/client.js";
import type { createIncidentManagement } from "../incident-management/index.js";
import { EvidenceRepository } from "./repositories.js";
import { evidenceRoutes } from "./routes.js";
import { defaultEvidenceConfig, EvidenceService, type EvidenceConfig } from "./services/evidence.service.js";

export function createEvidenceService(db: Database, incidents: ReturnType<typeof createIncidentManagement>, config: EvidenceConfig = defaultEvidenceConfig(), repo = new EvidenceRepository()) {
  return { repo, evidence: new EvidenceService(db, repo, incidents.incidents, config) };
}

export async function registerEvidenceService(app: FastifyInstance, e: ReturnType<typeof createEvidenceService>) {
  await app.register(evidenceRoutes, { prefix: "/api/v1", evidence: e.evidence });
}

export { defaultEvidenceConfig, EVIDENCE_ACTOR_ID } from "./services/evidence.service.js";
export type { EvidenceConfig } from "./services/evidence.service.js";
export { InMemoryArkiv, InMemoryChain, JsonRpcEthereumAnchor } from "./adapters/anchors.js";
export type { AnchorRef, ArkivClient, EthereumAnchorClient } from "./adapters/anchors.js";
export { loadArkivConfig, type ArkivConfig, type ArkivConfigState } from "./adapters/arkiv/config.js";
export { SdkArkivClient, type ArkivHealth } from "./adapters/arkiv/sdk-client.js";
export { ArkivError, classifyArkivError, type ArkivErrorCode } from "./adapters/arkiv/errors.js";
export { EVIDENCE_ANCHOR_ABI, evidenceRef, incidentRef, ViemEthereumAnchor, type ViemAnchorConfig } from "./adapters/viem-ethereum.js";
export * from "./types.js";
