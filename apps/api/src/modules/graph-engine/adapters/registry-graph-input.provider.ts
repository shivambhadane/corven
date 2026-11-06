import type { Database } from "../../../db/client.js";
import type { AgentRepository } from "../../agent-registry/repositories/agent.repository.js";
import type { DependencyRepository } from "../../dependency-registry/repositories/dependency.repository.js";
import type { ResourceRepository } from "../../dependency-registry/repositories/resource.repository.js";
import { GraphError } from "../errors.js";
import { LIMITS, type GraphInput } from "../types/graph.types.js";

/**
 * Read-only adapter over the canonical registries. Everything is read inside
 * ONE read-only REPEATABLE READ transaction, so agents, resources and
 * dependencies come from the same point in time even while writers are active.
 * It performs no writes and every query is scoped to the organization.
 */
export class RegistryGraphInputProvider {
  constructor(
    private readonly db: Database,
    private readonly agents: AgentRepository,
    private readonly resources: ResourceRepository,
    private readonly dependencies: DependencyRepository,
  ) {}

  async load(organizationId: string): Promise<GraphInput> {
    try {
      return await this.db.transaction(
        async (tx) => {
          // One connection runs one query at a time: keep these sequential.
          const a = await this.agents.listAgents(tx, organizationId, { limit: 1, offset: 0 });
          const r = await this.resources.list(tx, organizationId, { limit: 1, offset: 0 });
          const d = await this.dependencies.list(tx, organizationId, { limit: 1, offset: 0 });
          if (a.total + r.total > LIMITS.maxNodes || d.total > LIMITS.maxEdges) {
            throw new GraphError("GRAPH_BUILD_FAILED", "The organization's inventory exceeds the in-memory graph size limit", {
              maxNodes: LIMITS.maxNodes,
              maxEdges: LIMITS.maxEdges,
            });
          }
          const [agents, resources, dependencies] = [
            await this.agents.listAll(tx, organizationId),
            await this.resources.listAll(tx, organizationId),
            await this.dependencies.listAll(tx, organizationId),
          ];
          return {
            agents: agents.map((x) => ({ id: x.id, organizationId: x.organizationId, name: x.name, status: x.status, agentType: x.agentType, externalReference: x.externalReference })),
            resources: resources.map((x) => ({ id: x.id, organizationId: x.organizationId, name: x.name, resourceType: x.resourceType, externalReference: x.externalReference })),
            dependencies: dependencies.map((x) => ({
              id: x.id,
              organizationId: x.organizationId,
              sourceType: x.sourceType,
              sourceId: x.sourceId,
              targetType: x.targetType,
              targetId: x.targetId,
              dependencyType: x.dependencyType,
              relationship: x.relationship,
              status: x.status,
              confidence: x.confidence,
              provenance: { ...x.provenance },
              metadata: x.metadata,
              version: x.version,
              createdAt: x.createdAt,
              updatedAt: x.updatedAt,
            })),
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    } catch (err) {
      if (err instanceof GraphError) throw err;
      // Do not leak SQL or registry details; the cause is logged by the caller's error handler.
      const failure = new GraphError("GRAPH_BUILD_FAILED", "The graph could not be built from the registries");
      (failure as { cause?: unknown }).cause = err; // logged server-side, never serialised to the client
      throw failure;
    }
  }
}
