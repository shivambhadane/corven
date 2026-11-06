import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import type { Database } from "../../../db/client.js";
import { AppError, NotFoundError } from "../../../errors.js";
import type { Graph } from "../../graph-engine/core/graph.js";
import type { GraphQueryService } from "../../graph-engine/services/graph-query.service.js";
import { contentHash, diffPayloads, graphFromPayload, snapshotPayload, type SnapshotDiff } from "../core/snapshot.js";
import type { SnapshotMeta, SnapshotRepository } from "../repositories/snapshot.repository.js";

export class SnapshotNotFoundError extends NotFoundError {
  constructor() {
    super("Snapshot not found");
    (this as { code: string }).code = "SNAPSHOT_NOT_FOUND";
  }
}
export class SnapshotIntegrityError extends AppError {
  constructor() {
    super(500, "SNAPSHOT_INTEGRITY_FAILED", "The stored snapshot does not match its content hash and cannot be used");
  }
}

export interface VerifyResult {
  valid: boolean;
  storedHash: string;
  computedHash: string;
}

/**
 * Persists immutable point-in-time copies of the graph so an incident can be
 * analysed against a fixed graph. The Graph Engine builds; this service stores,
 * verifies and reloads. It never changes registries.
 */
export class SnapshotService {
  constructor(
    private readonly db: Database,
    private readonly repo: SnapshotRepository,
    private readonly graphs: GraphQueryService,
  ) {}

  async create(principal: Principal, input: { label?: string | undefined; incidentId?: string | undefined } = {}): Promise<SnapshotMeta> {
    assertCan(principal, "snapshot:write");
    const { graph } = await this.graphs.build(principal.organizationId);
    const payload = snapshotPayload(graph);
    return this.repo.insert(this.db, {
      organizationId: principal.organizationId,
      label: input.label?.trim() || null,
      incidentId: input.incidentId ?? null,
      createdBy: principal.actorId,
      nodeCount: graph.metadata.nodeCount,
      edgeCount: graph.metadata.edgeCount,
      contentHash: contentHash(principal.organizationId, payload),
      payload,
      builtAt: graph.metadata.builtAt,
    });
  }

  async list(principal: Principal, page: { limit: number; offset: number }, incidentId?: string) {
    assertCan(principal, "snapshot:read");
    return this.repo.list(this.db, principal.organizationId, page, incidentId);
  }

  async get(principal: Principal, id: string): Promise<SnapshotMeta> {
    assertCan(principal, "snapshot:read");
    const rec = await this.repo.find(this.db, principal.organizationId, id);
    if (!rec) throw new SnapshotNotFoundError();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit
    const { payload: _p, ...meta } = rec;
    return meta;
  }

  /** The stored graph, only after its hash has been re-checked. */
  async getPayload(principal: Principal, id: string) {
    assertCan(principal, "snapshot:read");
    const rec = await this.repo.find(this.db, principal.organizationId, id);
    if (!rec) throw new SnapshotNotFoundError();
    if (contentHash(rec.organizationId, rec.payload) !== rec.contentHash) throw new SnapshotIntegrityError();
    return rec;
  }

  /** Reports instead of throwing, so a failed check is visible rather than an error. */
  async verify(principal: Principal, id: string): Promise<VerifyResult> {
    assertCan(principal, "snapshot:read");
    const rec = await this.repo.find(this.db, principal.organizationId, id);
    if (!rec) throw new SnapshotNotFoundError();
    const computedHash = contentHash(rec.organizationId, rec.payload);
    return { valid: computedHash === rec.contentHash, storedHash: rec.contentHash, computedHash };
  }

  /** Reconstructs the immutable Graph from a snapshot (hash verified first). */
  async loadGraph(principal: Principal, id: string): Promise<Graph> {
    const rec = await this.getPayload(principal, id);
    return graphFromPayload(rec.organizationId, rec.payload, rec.builtAt);
  }

  async diff(principal: Principal, fromId: string, toId: string): Promise<SnapshotDiff & { from: string; to: string }> {
    const [a, b] = [await this.getPayload(principal, fromId), await this.getPayload(principal, toId)];
    return { from: fromId, to: toId, ...diffPayloads(a.payload, b.payload) };
  }
}
