import { describe, expect, it } from "vitest";
import { classifyEdges, toContainmentCoverage } from "../src/modules/authorization-gateway/core/coverage.js";
import { formatCredential, hashSecret, newSecret, parseCredential, secretMatches } from "../src/modules/authorization-gateway/core/credentials.js";
import { signToken, verifyToken, type AgentClaims } from "../src/modules/authorization-gateway/core/jwt.js";
import { evaluate, type PolicyInput } from "../src/modules/authorization-gateway/core/policy.js";
import type { Permission } from "../src/modules/authorization-gateway/types.js";

const secret = Buffer.alloc(32, 9);
const now = new Date("2026-11-06T12:00:00Z");
const t = Math.floor(now.getTime() / 1000);
const claims = (over: Partial<AgentClaims> = {}): AgentClaims => ({ iss: "corven", aud: "corven-gateway", sub: "a", org: "o", cid: "c", jti: "j", iat: t, nbf: t, exp: t + 300, ...over });
const expectOk = { issuer: "corven", audience: "corven-gateway", now };

describe("agent tokens (HS256)", () => {
  it("round-trips valid claims", () => {
    const v = verifyToken(secret, signToken(secret, claims()), expectOk);
    expect(v).toMatchObject({ ok: true, claims: { sub: "a", org: "o" } });
  });
  it("rejects a wrong key, a tampered payload and a swapped signature", () => {
    const good = signToken(secret, claims());
    expect(verifyToken(Buffer.alloc(32, 1), good, expectOk)).toEqual({ ok: false, reason: "bad_signature" });
    const [h, , s] = good.split(".");
    const forged = Buffer.from(JSON.stringify(claims({ org: "other" }))).toString("base64url");
    expect(verifyToken(secret, `${h}.${forged}.${s}`, expectOk)).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("rejects alg none and any other algorithm", () => {
    const body = Buffer.from(JSON.stringify(claims())).toString("base64url");
    for (const alg of ["none", "HS512", "RS256"]) {
      const head = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url");
      expect(verifyToken(secret, `${head}.${body}.`, expectOk).ok).toBe(false);
      expect(verifyToken(secret, `${head}.${body}.abc`, expectOk).ok).toBe(false);
    }
  });
  it("checks expiry, not-before, issuer and audience", () => {
    expect(verifyToken(secret, signToken(secret, claims({ exp: t })), expectOk)).toEqual({ ok: false, reason: "expired" });
    expect(verifyToken(secret, signToken(secret, claims({ nbf: t + 60 })), expectOk)).toEqual({ ok: false, reason: "not_yet_valid" });
    expect(verifyToken(secret, signToken(secret, claims({ iss: "evil" })), expectOk)).toEqual({ ok: false, reason: "bad_issuer" });
    expect(verifyToken(secret, signToken(secret, claims({ aud: "other" })), expectOk)).toEqual({ ok: false, reason: "bad_audience" });
  });
  it("rejects malformed input", () => {
    for (const bad of ["", "a.b", "a.b.c.d", "not a token", "a..c", "%%.%%.%%"]) expect(verifyToken(secret, bad, expectOk).ok).toBe(false);
  });
});

describe("bootstrap credentials", () => {
  it("formats, parses and matches in constant time; stores only a hash", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    const s = newSecret();
    const raw = formatCredential(id, s);
    expect(parseCredential(raw)).toEqual({ credentialId: id, secret: s });
    expect(s).toHaveLength(43);
    const h = hashSecret(s);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(s);
    expect(secretMatches(s, h)).toBe(true);
    expect(secretMatches(newSecret(), h)).toBe(false);
  });
  it("rejects anything not in the credential format", () => {
    for (const bad of ["", "cvn_x.y", "abc", `cvn_11111111-2222-4333-8444-555555555555.short`, `xxx_11111111-2222-4333-8444-555555555555.${newSecret()}`]) expect(parseCredential(bad)).toBeNull();
  });
});

const grant = (over: Partial<Permission> = {}): Permission => ({
  id: "p1", organizationId: "o", agentId: "a", resourceId: "r", action: "transfer", constraints: {}, status: "active", version: 3,
  grantedBy: "u", createdAt: now, revokedAt: null, revokedBy: null, revokeReason: null, ...over,
});
const input = (over: Partial<PolicyInput> = {}): PolicyInput => ({
  now, action: "transfer", payload: { amount: 10 }, agent: { status: "active" }, credentialActive: true, resource: { id: "r" }, permissions: [grant()], restricted: false, ...over,
});

describe("policy evaluator", () => {
  it("allows only when everything passes, and reports the permission used", () => {
    expect(evaluate(input())).toEqual({ decision: "allow", reasonCodes: ["ALLOWED"], permissionId: "p1", permissionVersion: 3 });
  });
  it("denies by default", () => {
    expect(evaluate(input({ permissions: [] })).reasonCodes).toEqual(["NO_PERMISSION"]);
    expect(evaluate(input({ action: "delete" })).reasonCodes).toEqual(["NO_PERMISSION"]); // a grant for another action is not a grant
  });
  it.each(["suspended", "compromised", "inactive"])("denies a %s agent even with a valid grant", (status) => {
    expect(evaluate(input({ agent: { status } })).reasonCodes).toEqual(["AGENT_NOT_ACTIVE"]);
  });
  it("denies unknown agents, inactive credentials and unknown resources", () => {
    expect(evaluate(input({ agent: null })).reasonCodes).toEqual(["AGENT_NOT_FOUND"]);
    expect(evaluate(input({ credentialActive: false })).reasonCodes).toEqual(["CREDENTIAL_INACTIVE"]);
    expect(evaluate(input({ resource: null, permissions: [] })).reasonCodes).toEqual(["RESOURCE_UNKNOWN"]);
  });
  it("ignores revoked grants", () => {
    expect(evaluate(input({ permissions: [grant({ status: "revoked" })] })).reasonCodes).toEqual(["NO_PERMISSION"]);
  });
  it("a containment restriction beats any grant", () => {
    expect(evaluate(input({ restricted: true })).reasonCodes).toEqual(["RESTRICTED_BY_CONTAINMENT"]);
  });
  it("enforces maxAmount, including a missing, negative or non-numeric amount", () => {
    const limited = [grant({ constraints: { maxAmount: 100 } })];
    expect(evaluate(input({ permissions: limited, payload: { amount: 100 } })).decision).toBe("allow");
    for (const payload of [{ amount: 101 }, {}, null, { amount: "5" }, { amount: -1 }, { amount: Number.NaN }]) {
      expect(evaluate(input({ permissions: limited, payload })).reasonCodes, JSON.stringify(payload)).toEqual(["CONSTRAINT_VIOLATED"]);
    }
  });
  it("enforces expiry", () => {
    const past = new Date(now.getTime() - 1000).toISOString();
    expect(evaluate(input({ permissions: [grant({ constraints: { expiresAt: past } })] })).reasonCodes).toEqual(["PERMISSION_EXPIRED"]);
    expect(evaluate(input({ permissions: [grant({ constraints: { expiresAt: new Date(now.getTime() + 1000).toISOString() } })] })).decision).toBe("allow");
  });
  it("another grant can still allow when one is constrained out", () => {
    const grants = [grant({ id: "tight", constraints: { maxAmount: 1 } }), grant({ id: "wide", constraints: { maxAmount: 1000 } })];
    expect(evaluate(input({ permissions: grants })).permissionId).toBe("wide");
  });
});

describe("enforcement coverage", () => {
  const edges = [
    { id: "e1", dependencyType: "resource" as const, sourceNodeId: "agent:1", targetNodeId: "resource:gw" },
    { id: "e2", dependencyType: "resource" as const, sourceNodeId: "agent:1", targetNodeId: "resource:adv" },
    { id: "e3", dependencyType: "resource" as const, sourceNodeId: "agent:1", targetNodeId: "resource:none" },
    { id: "e4", dependencyType: "authority" as const, sourceNodeId: "agent:1", targetNodeId: "agent:2" },
    { id: "e5", dependencyType: "operational" as const, sourceNodeId: "agent:2", targetNodeId: "agent:3" },
  ];
  const modes = new Map([["resource:gw", "gateway" as const], ["resource:adv", "advisory" as const]]);
  it("classifies by what can actually be enforced", () => {
    const r = classifyEdges("o", edges, modes, now);
    const by = Object.fromEntries(r.edges.map((e) => [e.edgeId, e.classification]));
    expect(by).toEqual({ e1: "CONTROLLED", e2: "PARTIALLY_CONTROLLED", e3: "UNKNOWN", e4: "NOT_CONTROLLED", e5: "NOT_CONTROLLED" });
    expect(r.summary).toEqual({ CONTROLLED: 1, PARTIALLY_CONTROLLED: 1, NOT_CONTROLLED: 2, UNKNOWN: 1 });
    expect(r.limitations.join(" ")).toMatch(/cannot detect access that bypasses the gateway/);
  });
  it("maps to the containment engine: uncontrollable and unknown are blocked, partial costs more", () => {
    expect(toContainmentCoverage(classifyEdges("o", edges, modes, now))).toEqual({ uncontrollableEdgeIds: ["e3", "e4", "e5"], edgeCosts: { e2: 2 }, defaultCost: 1 });
  });
});
