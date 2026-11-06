import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A bootstrap credential looks like `cvn_<credentialId>.<secret>`. The id lets the
 * server find the row without being told which agent is calling; the secret is
 * 32 random bytes, so a plain SHA-256 is sufficient (there is nothing to brute
 * force) and no slow password hash is needed.
 */
const FORMAT = /^cvn_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

export const newSecret = () => randomBytes(32).toString("base64url");
export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");
export const formatCredential = (credentialId: string, secret: string) => `cvn_${credentialId}.${secret}`;

export function parseCredential(raw: string): { credentialId: string; secret: string } | null {
  const m = FORMAT.exec(raw);
  return m ? { credentialId: m[1]!.toLowerCase(), secret: m[2]! } : null;
}

/** Constant-time comparison of a presented secret with a stored hash. */
export function secretMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
