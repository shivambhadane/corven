import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Principal } from "../../auth/principal.js";

/** Personas a demo visitor can act as inside THEIR OWN sandbox organization. Distinct actors so separation of duties still applies. */
export const DEMO_PERSONAS = ["admin", "operator", "approver"] as const;
export type DemoPersona = (typeof DEMO_PERSONAS)[number];

export interface DemoClaims { org: string; exp: number }

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/**
 * Demo session tokens: `cdemo_<payload>.<hmac>`. The key is random per server process, so every demo session ends when the
 * server restarts (and with it the in-memory simulated executors the sandbox relies on). They grant access to exactly one
 * sandbox organization and nothing else.
 */
export class DemoTokens {
  private readonly key: Buffer;
  constructor(key: Buffer = randomBytes(32), private readonly now: () => Date = () => new Date()) {
    this.key = key;
  }

  issue(org: string, ttlSeconds: number): { token: string; expiresAt: Date } {
    const exp = Math.floor(this.now().getTime() / 1000) + ttlSeconds;
    const payload = b64(JSON.stringify({ org, exp } satisfies DemoClaims));
    return { token: `cdemo_${payload}.${this.sign(payload)}`, expiresAt: new Date(exp * 1000) };
  }

  verify(token: string | undefined): DemoClaims | null {
    if (!token || token.length > 512 || !token.startsWith("cdemo_")) return null;
    const [payload, sig] = token.slice(6).split(".");
    if (!payload || !sig) return null;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<DemoClaims>;
      if (typeof c.org !== "string" || !/^[0-9a-f-]{36}$/i.test(c.org) || typeof c.exp !== "number") return null;
      if (c.exp * 1000 <= this.now().getTime()) return null;
      return { org: c.org, exp: c.exp };
    } catch {
      return null;
    }
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.key).update(`corven-demo:${payload}`).digest("base64url");
  }
}

/** A stable actor id per (sandbox, persona), shaped like a UUID so it fits every actor column. */
export function demoActor(org: string, persona: DemoPersona): string {
  const h = createHash("sha256").update(`demo-actor:${org}:${persona}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function demoPrincipal(claims: DemoClaims, persona: string | undefined): Principal | null {
  const p = (persona ?? "operator") as DemoPersona;
  if (!(DEMO_PERSONAS as readonly string[]).includes(p)) return null;
  return { actorId: demoActor(claims.org, p), organizationId: claims.org, role: p, demo: true };
}
