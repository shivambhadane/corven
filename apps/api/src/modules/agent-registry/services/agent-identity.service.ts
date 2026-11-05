import type { Database } from "../../../db/client.js";
import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import { NotFoundError } from "../../../errors.js";
import { normalizeIdentities, type IdentityInput } from "../policies/agent-input.policy.js";
import type { AgentRepository } from "../repositories/agent.repository.js";
import type { AgentIdentity, VerificationStatus } from "../types/agent.types.js";
import { identitySnapshot, loadAgent, mapUniqueViolation } from "./shared.js";

const keyOf = (i: { identityType: string; identityValue: string; chainId: number | null }) =>
  `${i.identityType}|${i.identityValue.toLowerCase()}|${i.chainId ?? 0}`;

export class AgentIdentityService {
  constructor(
    private readonly db: Database,
    private readonly repo: AgentRepository,
  ) {}

  /**
   * Replaces the agent's declared identities. Callers can never set a
   * verification status here: new identities are always `unverified`, and an
   * identity that is unchanged keeps its existing verification state.
   */
  async replace(principal: Principal, agentId: string, input: IdentityInput[]): Promise<AgentIdentity[]> {
    assertCan(principal, "agent:write");
    const next = normalizeIdentities(input);
    const org = principal.organizationId;
    try {
      return await this.db.transaction(async (tx) => {
        await loadAgent(this.repo, tx, org, agentId, true);
        const before = await this.repo.getIdentities(tx, org, agentId);
        const nextKeys = new Set(next.map(keyOf));
        const beforeByKey = new Map(before.map((i) => [keyOf(i), i]));

        await this.repo.deleteIdentities(tx, org, agentId, before.filter((i) => !nextKeys.has(keyOf(i))).map((i) => i.id));
        for (const i of next) {
          if (!beforeByKey.has(keyOf(i))) {
            await this.repo.insertIdentity(tx, { organizationId: org, agentId, ...i });
          }
        }
        const after = await this.repo.getIdentities(tx, org, agentId);
        await this.repo.insertAudit(tx, {
          organizationId: org,
          agentId,
          actorId: principal.actorId,
          action: "agent.identities_changed",
          beforeState: { identities: before.map(identitySnapshot) },
          afterState: { identities: after.map(identitySnapshot) },
        });
        return after;
      });
    } catch (err) {
      return mapUniqueViolation(err);
    }
  }

  /**
   * The ONLY path that can set an identity to `verified`. It requires
   * `agent:identity:verify` (admin). It is deliberately not exposed over HTTP:
   * real verification (e.g. ENS resolution) is a future integration, and this
   * method must be called by that verifier, not by arbitrary clients.
   */
  async recordVerification(
    principal: Principal,
    agentId: string,
    identityId: string,
    status: VerificationStatus,
  ): Promise<AgentIdentity> {
    assertCan(principal, "agent:identity:verify");
    const org = principal.organizationId;
    return this.db.transaction(async (tx) => {
      await loadAgent(this.repo, tx, org, agentId, true);
      const before = (await this.repo.getIdentities(tx, org, agentId)).find((i) => i.id === identityId);
      if (!before) throw new NotFoundError("Identity not found");
      const after = await this.repo.setIdentityVerification(tx, org, agentId, identityId, status);
      if (!after) throw new NotFoundError("Identity not found");
      await this.repo.insertAudit(tx, {
        organizationId: org,
        agentId,
        actorId: principal.actorId,
        action: "agent.identity_verification_recorded",
        beforeState: identitySnapshot(before),
        afterState: identitySnapshot(after),
      });
      return after;
    });
  }
}
