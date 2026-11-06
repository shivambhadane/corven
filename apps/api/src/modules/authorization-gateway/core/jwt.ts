import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal HS256 JSON Web Token support for short-lived machine tokens.
 * Only HS256 is accepted: the header's `alg` is checked, never trusted to pick
 * the algorithm (so `none` and algorithm-confusion tokens are rejected).
 * A later move to asymmetric workload identity replaces this file only.
 */
export interface AgentClaims {
  iss: string;
  aud: string;
  sub: string;
  org: string;
  cid: string;
  jti: string;
  iat: number;
  nbf: number;
  exp: number;
}

const b64 = (v: Buffer | string) => Buffer.from(v).toString("base64url");
const mac = (secret: Buffer, data: string) => createHmac("sha256", secret).update(data).digest();

export function signToken(secret: Buffer, claims: AgentClaims): string {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify(claims));
  return `${head}.${body}.${mac(secret, `${head}.${body}`).toString("base64url")}`;
}

export type VerifyFailure = "malformed" | "bad_algorithm" | "bad_signature" | "expired" | "not_yet_valid" | "bad_issuer" | "bad_audience" | "bad_claims";

export function verifyToken(secret: Buffer, token: string, expect: { issuer: string; audience: string; now: Date; clockSkewSeconds?: number }): { ok: true; claims: AgentClaims } | { ok: false; reason: VerifyFailure } {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, reason: "malformed" };
  const [head, body, sig] = parts as [string, string, string];
  let header: { alg?: unknown; typ?: unknown };
  let claims: Partial<AgentClaims>;
  try {
    header = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (header.alg !== "HS256") return { ok: false, reason: "bad_algorithm" };
  const expected = mac(secret, `${head}.${body}`);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_signature" };

  const t = Math.floor(expect.now.getTime() / 1000);
  const skew = expect.clockSkewSeconds ?? 0;
  const c = claims;
  if (typeof c.sub !== "string" || typeof c.org !== "string" || typeof c.cid !== "string" || typeof c.jti !== "string" || typeof c.exp !== "number" || typeof c.iat !== "number" || typeof c.nbf !== "number") {
    return { ok: false, reason: "bad_claims" };
  }
  if (c.iss !== expect.issuer) return { ok: false, reason: "bad_issuer" };
  if (c.aud !== expect.audience) return { ok: false, reason: "bad_audience" };
  if (t >= c.exp + skew) return { ok: false, reason: "expired" };
  if (t < c.nbf - skew) return { ok: false, reason: "not_yet_valid" };
  return { ok: true, claims: c as AgentClaims };
}
