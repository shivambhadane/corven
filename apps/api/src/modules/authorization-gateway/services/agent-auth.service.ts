import { randomUUID } from "node:crypto";
import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import type { Database } from "../../../db/client.js";
import { AppError, ValidationError } from "../../../errors.js";
import { formatCredential, hashSecret, newSecret, parseCredential, secretMatches } from "../core/credentials.js";
import { signToken, verifyToken } from "../core/jwt.js";
import { AgentAuthUnavailableError, credentialExists, EnforcementUnavailableError, InvalidCredentialError, InvalidTokenError, noActiveCredential, notFound } from "../errors.js";
import type { GatewayRepository } from "../repositories/gateway.repository.js";
import type { AuthenticatedAgent } from "../types.js";

export interface AgentAuthConfig {
  /** HMAC key, at least 32 bytes. Without it, token issuance and verification are unavailable (fail closed). */
  secret: Buffer | null;
  issuer: string;
  audience: string;
  ttlSeconds: number;
  now: () => Date;
}

export const defaultAgentAuthConfig = (secret: Buffer | null): AgentAuthConfig => ({ secret, issuer: "corven", audience: "corven-gateway", ttlSeconds: 300, now: () => new Date() });

export interface AgentLookup {
  getAgent(organizationId: string, agentId: string): Promise<{ id: string; status: string } | null>;
}

export interface IssuedCredential {
  credentialId: string;
  agentId: string;
  /** Shown exactly once. Only its hash is stored. */
  credential: string;
  expiresAt: string | null;
}

export class AgentAuthService {
  constructor(
    private readonly db: Database,
    private readonly repo: GatewayRepository,
    private readonly agents: AgentLookup,
    private readonly config: AgentAuthConfig,
  ) {
    if (config.secret && config.secret.length < 32) throw new Error("The agent token secret must be at least 32 bytes");
  }

  // ------------------------------------------------------------------ credential administration (humans)

  async issue(p: Principal, agentId: string, input: { expiresAt?: Date | undefined; reason?: string | undefined } = {}): Promise<IssuedCredential> {
    assertCan(p, "credential:manage");
    await this.assertAgent(p.organizationId, agentId);
    if (input.expiresAt && input.expiresAt.getTime() <= this.config.now().getTime()) throw new ValidationError("expiresAt must be in the future");
    return this.db.transaction(async (tx) => {
      if (await this.repo.lockActiveCredential(tx, p.organizationId, agentId)) throw credentialExists();
      const issued = await this.create(tx, p, agentId, input.expiresAt ?? null);
      await this.repo.addCredentialHistory(tx, { organizationId: p.organizationId, agentId, credentialId: issued.credentialId, action: "issued", actorId: p.actorId, actorType: "human", reason: input.reason ?? null });
      await this.repo.addAudit(tx, { organizationId: p.organizationId, actorId: p.actorId, actorType: "human", action: "credential.issued", targetType: "credential", targetId: issued.credentialId, afterState: { agentId } });
      return issued;
    });
  }

  /** Revokes the current credential and issues a new one in one transaction, so there is never a moment with two or none by accident. */
  async rotate(p: Principal, agentId: string, input: { expiresAt?: Date | undefined; reason: string }): Promise<IssuedCredential> {
    assertCan(p, "credential:manage");
    await this.assertAgent(p.organizationId, agentId);
    return this.db.transaction(async (tx) => {
      const old = await this.repo.lockActiveCredential(tx, p.organizationId, agentId);
      if (!old) throw noActiveCredential();
      await this.repo.revokeCredential(tx, p.organizationId, old.id, p.actorId, `rotated: ${input.reason}`);
      const issued = await this.create(tx, p, agentId, input.expiresAt ?? null);
      await this.repo.addCredentialHistory(tx, { organizationId: p.organizationId, agentId, credentialId: issued.credentialId, previousCredentialId: old.id, action: "rotated", actorId: p.actorId, actorType: "human", reason: input.reason });
      await this.repo.addAudit(tx, { organizationId: p.organizationId, actorId: p.actorId, actorType: "human", action: "credential.rotated", targetType: "credential", targetId: issued.credentialId, beforeState: { credentialId: old.id }, afterState: { credentialId: issued.credentialId } });
      return issued;
    });
  }

  async revoke(p: Principal, agentId: string, reason: string): Promise<{ revoked: boolean; credentialId: string | null }> {
    assertCan(p, "credential:manage");
    await this.assertAgent(p.organizationId, agentId);
    return this.revokeForAgent(p.organizationId, agentId, { actorId: p.actorId, actorType: "human" }, reason);
  }

  /** Also used by the credential enforcement adapter. Revoking when there is no active credential is a no-op, not an error. */
  async revokeForAgent(organizationId: string, agentId: string, actor: { actorId: string; actorType: "human" | "system" }, reason: string) {
    return this.db.transaction(async (tx) => {
      const cur = await this.repo.lockActiveCredential(tx, organizationId, agentId);
      if (!cur) return { revoked: false, credentialId: null };
      await this.repo.revokeCredential(tx, organizationId, cur.id, actor.actorId, reason);
      await this.repo.addCredentialHistory(tx, { organizationId, agentId, credentialId: cur.id, action: "revoked", actorId: actor.actorId, actorType: actor.actorType, reason });
      await this.repo.addAudit(tx, { organizationId, actorId: actor.actorId, actorType: actor.actorType, action: "credential.revoked", targetType: "credential", targetId: cur.id, beforeState: { status: "active" }, afterState: { status: "revoked", reason } });
      return { revoked: true, credentialId: cur.id };
    });
  }

  async history(p: Principal, agentId: string) {
    assertCan(p, "credential:manage");
    await this.assertAgent(p.organizationId, agentId);
    return this.repo.listCredentialHistory(this.db, p.organizationId, agentId);
  }

  // ------------------------------------------------------------------ agents authenticate

  /** Exchanges a bootstrap credential for a short-lived token. Every failure looks the same to the caller. */
  async exchange(rawCredential: string): Promise<{ token: string; tokenType: "Bearer"; expiresIn: number; expiresAt: string }> {
    const secret = this.requireSecret();
    const parsed = parseCredential(rawCredential);
    if (!parsed) throw new InvalidCredentialError();
    const now = this.config.now();
    const row = await this.guard(() => this.repo.findCredentialById(this.db, parsed.credentialId));
    // Hash comparison happens even for unknown ids' dummy path is unnecessary: the secret has 256 bits, so timing reveals nothing usable.
    if (!row || row.status !== "active" || !secretMatches(parsed.secret, row.secretHash)) throw new InvalidCredentialError();
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) throw new InvalidCredentialError();
    const agent = await this.guard(() => this.agents.getAgent(row.organizationId, row.agentId));
    if (!agent || agent.status !== "active") throw new InvalidCredentialError();

    const iat = Math.floor(now.getTime() / 1000);
    const exp = iat + this.config.ttlSeconds;
    const token = signToken(secret, { iss: this.config.issuer, aud: this.config.audience, sub: row.agentId, org: row.organizationId, cid: row.id, jti: randomUUID(), iat, nbf: iat, exp });
    return { token, tokenType: "Bearer", expiresIn: this.config.ttlSeconds, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /**
   * Validates a bearer token on every request: signature, issuer, audience,
   * expiry, and then the DATABASE, so revoking a credential or leaving the
   * active state takes effect immediately instead of when the token expires.
   * The agent identity comes only from the verified token.
   */
  async authenticate(authorizationHeader: string | undefined): Promise<AuthenticatedAgent> {
    const secret = this.requireSecret();
    const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(authorizationHeader ?? "");
    if (!m) throw new InvalidTokenError();
    const v = verifyToken(secret, m[1]!, { issuer: this.config.issuer, audience: this.config.audience, now: this.config.now() });
    if (!v.ok) throw new InvalidTokenError();
    const c = v.claims;
    const cred = await this.guard(() => this.repo.findCredentialById(this.db, c.cid));
    if (!cred || cred.status !== "active" || cred.agentId !== c.sub || cred.organizationId !== c.org) throw new InvalidTokenError();
    if (cred.expiresAt && cred.expiresAt.getTime() <= this.config.now().getTime()) throw new InvalidTokenError();
    return { agentId: c.sub, organizationId: c.org, credentialId: cred.id, tokenId: c.jti };
  }

  // ------------------------------------------------------------------ helpers

  private async create(tx: Parameters<GatewayRepository["insertCredential"]>[0], p: Principal, agentId: string, expiresAt: Date | null): Promise<IssuedCredential> {
    const id = randomUUID();
    const secret = newSecret();
    await this.repo.insertCredential(tx, { id, organizationId: p.organizationId, agentId, secretHash: hashSecret(secret), expiresAt, createdBy: p.actorId });
    return { credentialId: id, agentId, credential: formatCredential(id, secret), expiresAt: expiresAt ? expiresAt.toISOString() : null };
  }

  private requireSecret(): Buffer {
    if (!this.config.secret) throw new AgentAuthUnavailableError();
    return this.config.secret;
  }

  private async assertAgent(org: string, agentId: string): Promise<void> {
    if (!(await this.agents.getAgent(org, agentId))) throw notFound("Agent", "AGENT_NOT_FOUND");
  }

  /** A storage failure while authenticating is a denial, not a pass. */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new EnforcementUnavailableError("Authentication could not be checked and the request was denied");
    }
  }
}
