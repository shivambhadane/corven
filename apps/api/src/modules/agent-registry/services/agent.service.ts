import type { Database } from "../../../db/client.js";
import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import { initialStatus } from "../policies/agent-status.policy.js";
import { assertSafeMetadata, normalizeCapabilities, normalizeIdentities, type IdentityInput } from "../policies/agent-input.policy.js";
import type { AgentRepository, ListFilters } from "../repositories/agent.repository.js";
import type { Agent, AgentDetail, AgentType } from "../types/agent.types.js";
import { agentSnapshot, identitySnapshot, loadAgent, mapUniqueViolation } from "./shared.js";

export interface CreateAgentInput {
  name: string;
  description?: string | undefined;
  agentType: AgentType;
  runtimeType?: string | undefined;
  ownerReference?: string | undefined;
  externalReference?: string | undefined;
  capabilities?: string[] | undefined;
  identities?: IdentityInput[] | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface UpdateAgentInput {
  name?: string | undefined;
  description?: string | null | undefined;
  agentType?: AgentType | undefined;
  runtimeType?: string | null | undefined;
  ownerReference?: string | null | undefined;
  externalReference?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

const clean = (v: string | null | undefined): string | null => (v == null ? null : v.trim() || null);

export class AgentService {
  constructor(
    private readonly db: Database,
    private readonly repo: AgentRepository,
  ) {}

  async register(principal: Principal, input: CreateAgentInput): Promise<AgentDetail> {
    assertCan(principal, "agent:write");
    const metadata = assertSafeMetadata(input.metadata ?? {});
    const capabilities = normalizeCapabilities(input.capabilities ?? []);
    const identities = normalizeIdentities(input.identities ?? []);
    const status = initialStatus();
    const org = principal.organizationId;

    try {
      return await this.db.transaction(async (tx) => {
        const agent = await this.repo.insertAgent(tx, {
          organizationId: org,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          agentType: input.agentType,
          status,
          runtimeType: clean(input.runtimeType),
          ownerReference: clean(input.ownerReference),
          externalReference: clean(input.externalReference),
          metadata,
        });
        await this.repo.replaceCapabilities(tx, agent.id, capabilities);
        const createdIdentities = [];
        for (const i of identities) {
          createdIdentities.push(await this.repo.insertIdentity(tx, { organizationId: org, agentId: agent.id, ...i }));
        }
        await this.repo.insertStatusHistory(tx, {
          organizationId: org,
          agentId: agent.id,
          previousStatus: null,
          newStatus: status,
          actorId: principal.actorId,
          reason: "Initial registration",
          incidentId: null,
        });
        await this.repo.insertAudit(tx, {
          organizationId: org,
          agentId: agent.id,
          actorId: principal.actorId,
          action: "agent.created",
          beforeState: null,
          afterState: { ...agentSnapshot(agent), capabilities, identities: createdIdentities.map(identitySnapshot) },
        });
        return { ...agent, capabilities, identities: createdIdentities };
      });
    } catch (err) {
      return mapUniqueViolation(err);
    }
  }

  async get(principal: Principal, agentId: string): Promise<AgentDetail> {
    assertCan(principal, "agent:read");
    const org = principal.organizationId;
    return this.db.transaction(async (tx) => {
      const agent = await loadAgent(this.repo, tx, org, agentId);
      const [capabilities, identities] = await Promise.all([
        this.repo.getCapabilities(tx, agent.id),
        this.repo.getIdentities(tx, org, agent.id),
      ]);
      return { ...agent, capabilities, identities };
    });
  }

  async list(principal: Principal, filters: ListFilters): Promise<{ items: Agent[]; total: number }> {
    assertCan(principal, "agent:read");
    return this.repo.listAgents(this.db, principal.organizationId, filters);
  }

  /** Only name, description, agentType and metadata are updatable. Status has its own operation. */
  async update(principal: Principal, agentId: string, input: UpdateAgentInput): Promise<AgentDetail> {
    assertCan(principal, "agent:write");
    const org = principal.organizationId;
    const patch: Parameters<AgentRepository["updateAgent"]>[3] = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.description !== undefined) patch.description = input.description === null ? null : input.description.trim() || null;
    if (input.agentType !== undefined) patch.agentType = input.agentType;
    if (input.runtimeType !== undefined) patch.runtimeType = clean(input.runtimeType);
    if (input.ownerReference !== undefined) patch.ownerReference = clean(input.ownerReference);
    if (input.externalReference !== undefined) patch.externalReference = clean(input.externalReference);
    if (input.metadata !== undefined) patch.metadata = assertSafeMetadata(input.metadata);

    try {
      return await this.db.transaction(async (tx) => {
        const before = await loadAgent(this.repo, tx, org, agentId, true);
        const after = await this.repo.updateAgent(tx, org, agentId, patch);
        await this.repo.insertAudit(tx, {
          organizationId: org,
          agentId,
          actorId: principal.actorId,
          action: "agent.updated",
          beforeState: agentSnapshot(before),
          afterState: agentSnapshot(after),
        });
        const [capabilities, identities] = await Promise.all([
          this.repo.getCapabilities(tx, agentId),
          this.repo.getIdentities(tx, org, agentId),
        ]);
        return { ...after, capabilities, identities };
      });
    } catch (err) {
      return mapUniqueViolation(err);
    }
  }
}
