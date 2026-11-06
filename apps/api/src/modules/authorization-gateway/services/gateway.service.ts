import { randomUUID } from "node:crypto";
import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import type { Database } from "../../../db/client.js";
import { canonicalHash } from "../../../common/canonical.js";
import { AppError, ValidationError } from "../../../errors.js";
import type { Graph } from "../../graph-engine/core/graph.js";
import { classifyEdges, type CoverageReport } from "../core/coverage.js";
import { evaluate } from "../core/policy.js";
import { EnforcementUnavailableError, executionInProgress } from "../errors.js";
import type { ExecutionRow, GatewayRepository } from "../repositories/gateway.repository.js";
import type { ResourceExecutors } from "../adapters/resource-executor.js";
import type { AuthenticatedAgent, Decision, EnforcementMode, ReasonCode, RequestMeta } from "../types.js";
import type { AgentLookup } from "./agent-auth.service.js";

export interface ResourceResolver {
  /** By id (UUID), else external reference, else name. Returns null when nothing matches. */
  resolve(organizationId: string, reference: string): Promise<{ id: string } | null>;
}
export interface CoverageGraphLoader {
  load(principal: Principal): Promise<Graph>;
}

export interface GatewayRequest {
  requestId: string;
  resource: string;
  action: string;
  payload?: unknown;
}

export interface GatewayResult {
  executionId: string | null;
  requestId: string;
  status: "denied" | "failed" | "submitted" | "executed";
  decision: { id: string; decision: "allow" | "deny"; reasonCodes: ReasonCode[] };
  simulated: boolean;
  externalReference: string | null;
  failureReason: string | null;
  result: unknown;
  replayed: boolean;
}

export interface GatewayHooks {
  /** Runs between the pre-check and the re-check. Tests use it to revoke access mid-flight. */
  afterPrecheck?: (ctx: { agent: AuthenticatedAgent; request: GatewayRequest }) => Promise<void>;
}

export interface ProbeResult {
  decisionId: string;
  decision: "allow" | "deny";
  reasonCodes: ReasonCode[];
  resourceId: string | null;
  hasCredential: boolean;
  /** not_attempted: denied, the resource was not contacted. no_probe: allowed, but the executor cannot be probed. */
  observed: "not_attempted" | "no_probe" | "reachable" | "unreachable" | "probe_error";
  probeDetail?: Record<string, unknown>;
  simulated?: boolean;
}

/** Recorded as the credential of a probe for an agent that has no active credential. */
const NO_CREDENTIAL = "00000000-0000-0000-0000-000000000000";
const MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_RESULT_BYTES = 8 * 1024;
const EXECUTOR_TIMEOUT_MS = 5000;

/**
 * The execution boundary. For each protected operation:
 *   claim the request id (at most once) -> pre-check -> re-check immediately before
 *   the resource is touched -> execute -> record exactly what happened.
 * Anything the gateway cannot evaluate is denied. A denial, a failure and a
 * success are different records; none is ever reported as another.
 */
export class GatewayService {
  constructor(
    private readonly db: Database,
    private readonly repo: GatewayRepository,
    private readonly agents: AgentLookup,
    private readonly resolver: ResourceResolver,
    private readonly executors: ResourceExecutors,
    private readonly coverageGraph: CoverageGraphLoader,
    private readonly hooks: GatewayHooks = {},
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Authorization decision only. Nothing is executed. */
  async check(agent: AuthenticatedAgent, input: Omit<GatewayRequest, "requestId"> & { requestId?: string | undefined }, meta: RequestMeta = {}): Promise<{ decisionId: string; decision: "allow" | "deny"; reasonCodes: ReasonCode[] }> {
    const request = { ...input, requestId: input.requestId ?? `check:${randomUUID()}` };
    const payloadHash = this.hashPayload(input.payload);
    const d = await this.decide(agent, request, "check", payloadHash, meta);
    return { decisionId: d.id, decision: d.decision.decision, reasonCodes: d.decision.reasonCodes };
  }

  async execute(agent: AuthenticatedAgent, request: GatewayRequest, meta: RequestMeta = {}): Promise<GatewayResult> {
    const payloadHash = this.hashPayload(request.payload);
    const org = agent.organizationId;

    let claim: ExecutionRow | null;
    try {
      claim = await this.repo.claimExecution(this.db, { organizationId: org, agentId: agent.agentId, requestId: request.requestId, resourceRef: request.resource, action: request.action, payloadHash, correlationId: meta.correlationId ?? null });
    } catch (e) {
      throw this.unavailable(e);
    }
    if (!claim) return this.replay(agent, request);

    const finalize = async (patch: Parameters<GatewayRepository["finalizeExecution"]>[3]) => this.repo.finalizeExecution(this.db, org, claim!.id, patch);
    const fail = async (e: unknown): Promise<never> => {
      // Best effort: if the database is what failed, the row stays 'pending' and is never retried.
      await finalize({ status: "failed", failureReason: "ENFORCEMENT_UNAVAILABLE" }).catch(() => undefined);
      throw this.unavailable(e);
    };

    let pre;
    try {
      pre = await this.decide(agent, request, "precheck", payloadHash, meta);
    } catch (e) {
      return fail(e);
    }
    const base = { executionId: claim.id, requestId: request.requestId, replayed: false };
    if (pre.decision.decision === "deny") {
      await finalize({ status: "denied", precheckDecisionId: pre.id, resourceId: pre.resourceId });
      return { ...base, status: "denied", decision: this.view(pre), simulated: false, externalReference: null, failureReason: null, result: null };
    }

    try {
      await this.hooks.afterPrecheck?.({ agent, request });
    } catch {
      /* a hook must never decide anything */
    }

    // Re-check immediately before the resource is touched: a revocation that landed since the pre-check wins.
    let rec;
    try {
      rec = await this.decide(agent, request, "recheck", payloadHash, meta);
    } catch (e) {
      return fail(e);
    }
    if (rec.decision.decision === "deny") {
      const codes: ReasonCode[] = [...new Set<ReasonCode>(["REVOKED_BEFORE_EXECUTION", ...rec.decision.reasonCodes])];
      await finalize({ status: "denied", precheckDecisionId: pre.id, recheckDecisionId: rec.id, resourceId: rec.resourceId, failureReason: codes.join(",") });
      return { ...base, status: "denied", decision: { id: rec.id, decision: "deny", reasonCodes: codes }, simulated: false, externalReference: null, failureReason: null, result: null };
    }

    const executor = this.executors.get(rec.resourceId!);
    if (!executor) {
      await finalize({ status: "failed", precheckDecisionId: pre.id, recheckDecisionId: rec.id, resourceId: rec.resourceId, failureReason: "EXECUTOR_NOT_CONFIGURED" });
      return { ...base, status: "failed", decision: this.view(rec), simulated: false, externalReference: null, failureReason: "EXECUTOR_NOT_CONFIGURED", result: null };
    }

    try {
      const out = await this.withTimeout(
        executor.execute({
          organizationId: org, agentId: agent.agentId, resourceId: rec.resourceId!, action: request.action, payload: request.payload ?? null, requestId: request.requestId,
          authorization: { decisionId: rec.id, permissionId: rec.decision.permissionId, permissionVersion: rec.decision.permissionVersion },
        }),
      );
      const stored = this.bound(out.result);
      await finalize({ status: out.status, precheckDecisionId: pre.id, recheckDecisionId: rec.id, resourceId: rec.resourceId, executor: executor.name, simulated: executor.simulated, externalReference: out.externalReference ?? null, result: stored as never });
      return { ...base, status: out.status, decision: this.view(rec), simulated: executor.simulated, externalReference: out.externalReference ?? null, failureReason: null, result: stored };
    } catch (e) {
      const reason = e instanceof Error ? e.message.slice(0, 300) : "executor failed";
      await finalize({ status: "failed", precheckDecisionId: pre.id, recheckDecisionId: rec.id, resourceId: rec.resourceId, executor: executor.name, simulated: executor.simulated, failureReason: reason });
      return { ...base, status: "failed", decision: this.view(rec), simulated: executor.simulated, externalReference: null, failureReason: reason, result: null };
    }
  }

  /**
   * For the Verification Service. Evaluates what this agent could do RIGHT NOW,
   * through the same decision path an operation takes, using the agent's current
   * credential state (not a token it holds). If allowed, the executor's
   * non-destructive probe is asked whether the resource would answer. Nothing is
   * executed. The decision is recorded like any other ("check" stage).
   */
  async probe(organizationId: string, agentId: string, input: { requestId: string; resource: string; action: string }): Promise<ProbeResult> {
    const cred = await this.repo.findActiveCredential(this.db, organizationId, agentId).catch((e: unknown) => {
      throw this.unavailable(e);
    });
    const agent: AuthenticatedAgent = { agentId, organizationId, credentialId: cred?.id ?? NO_CREDENTIAL, tokenId: "verification" };
    const d = await this.decide(agent, { requestId: input.requestId, resource: input.resource, action: input.action }, "check", this.hashPayload(null), {});
    const base = { decisionId: d.id, decision: d.decision.decision, reasonCodes: d.decision.reasonCodes, resourceId: d.resourceId, hasCredential: !!cred };
    if (d.decision.decision === "deny") return { ...base, observed: "not_attempted" };
    const executor = d.resourceId ? this.executors.get(d.resourceId) : undefined;
    if (!executor?.probe) return { ...base, observed: "no_probe" };
    try {
      const out = await this.withTimeout(executor.probe({ organizationId, agentId, resourceId: d.resourceId!, action: input.action, payload: null, requestId: input.requestId, authorization: { decisionId: d.id, permissionId: d.decision.permissionId, permissionVersion: d.decision.permissionVersion } }));
      return { ...base, observed: out.reachable ? "reachable" : "unreachable", probeDetail: out.detail ?? {}, simulated: executor.simulated };
    } catch (e) {
      return { ...base, observed: "probe_error", probeDetail: { error: e instanceof Error ? e.message.slice(0, 200) : "probe failed" } };
    }
  }

  /** Controllable edges of the organization's active dependency graph. */
  async coverage(p: Principal): Promise<CoverageReport> {
    assertCan(p, "gateway:read");
    const graph = await this.coverageGraph.load(p);
    const modes = new Map<string, EnforcementMode>((await this.repo.listModes(this.db, p.organizationId)).map((m) => [`resource:${m.resourceId}`, m.mode as EnforcementMode]));
    const edges = graph.edges().filter((e) => e.status === "active");
    return classifyEdges(p.organizationId, edges, modes, this.now());
  }

  async decisions(p: Principal, agentId: string, page: { limit: number; offset: number }) {
    assertCan(p, "gateway:read");
    return this.repo.listDecisions(this.db, p.organizationId, agentId, page);
  }

  // ------------------------------------------------------------------ internals

  /** Loads the current state, evaluates, and records the decision. Any storage failure throws; callers treat that as deny. */
  private async decide(agent: AuthenticatedAgent, request: GatewayRequest, stage: "check" | "precheck" | "recheck", payloadHash: string, meta: RequestMeta) {
    const org = agent.organizationId;
    try {
      const [a, cred, res] = await Promise.all([this.agents.getAgent(org, agent.agentId), this.repo.findCredentialById(this.db, agent.credentialId), this.resolver.resolve(org, request.resource)]);
      const credentialActive = !!cred && cred.status === "active" && cred.agentId === agent.agentId && cred.organizationId === org && (!cred.expiresAt || cred.expiresAt.getTime() > this.now().getTime());
      const permissions = res ? await this.repo.activePermissionsFor(this.db, org, agent.agentId, res.id) : [];
      const restricted = res ? await this.repo.hasRestriction(this.db, org, agent.agentId, res.id) : false;
      const decision: Decision = evaluate({ now: this.now(), action: request.action, payload: request.payload ?? null, agent: a, credentialActive, resource: res, permissions, restricted });
      const row = await this.repo.insertDecision(this.db, {
        organizationId: org, agentId: agent.agentId, requestId: request.requestId, stage, resourceRef: request.resource.slice(0, 200), resourceId: res?.id ?? null, action: request.action,
        decision: decision.decision, reasonCodes: decision.reasonCodes as never, permissionId: decision.permissionId, permissionVersion: decision.permissionVersion, payloadHash, credentialId: agent.credentialId, correlationId: meta.correlationId ?? null,
      });
      return { id: row.id, decision, resourceId: res?.id ?? null };
    } catch (e) {
      throw this.unavailable(e);
    }
  }

  private async replay(agent: AuthenticatedAgent, request: GatewayRequest): Promise<GatewayResult> {
    const rec = await this.repo.findExecution(this.db, agent.organizationId, agent.agentId, request.requestId).catch((e: unknown) => {
      throw this.unavailable(e);
    });
    if (!rec || rec.status === "pending") throw executionInProgress();
    const decisionId = rec.recheckDecisionId ?? rec.precheckDecisionId ?? "";
    return {
      executionId: rec.id, requestId: request.requestId, status: rec.status as GatewayResult["status"],
      decision: { id: decisionId, decision: rec.status === "denied" ? "deny" : "allow", reasonCodes: rec.status === "denied" ? ((rec.failureReason?.split(",") ?? ["NO_PERMISSION"]) as ReasonCode[]) : ["ALLOWED"] },
      simulated: rec.simulated, externalReference: rec.externalReference, failureReason: rec.status === "failed" ? rec.failureReason : null, result: rec.result, replayed: true,
    };
  }

  private view(d: { id: string; decision: Decision }) {
    return { id: d.id, decision: d.decision.decision, reasonCodes: d.decision.reasonCodes };
  }

  private hashPayload(payload: unknown): string {
    const size = Buffer.byteLength(JSON.stringify(payload ?? null), "utf8");
    if (size > MAX_PAYLOAD_BYTES) throw new ValidationError(`payload must be at most ${MAX_PAYLOAD_BYTES} bytes`);
    return canonicalHash(payload ?? null);
  }

  private bound(result: unknown): unknown {
    if (result === undefined) return null;
    return Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_RESULT_BYTES ? { truncated: true } : result;
  }

  private unavailable(e: unknown): AppError {
    return e instanceof AppError ? e : new EnforcementUnavailableError();
  }

  private withTimeout<T>(p: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error("executor timed out")), EXECUTOR_TIMEOUT_MS);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
  }
}
