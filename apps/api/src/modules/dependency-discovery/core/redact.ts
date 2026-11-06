const SECRET_KEY = /(pass(word|phrase)?|secret|token|private[_-]?key|api[_-]?key|mnemonic|seed[_-]?phrase|credential|authorization|bearer)/i;
const MAX_BYTES = 16 * 1024;

/**
 * Raw evidence is stored for investigation, so secrets must not be. Values under
 * secret-looking keys are replaced, and oversized payloads are replaced by a
 * marker. Best effort by key name; it is a guardrail, not a scanner.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1)]));
  }
  return typeof value === "string" && value.length > 1000 ? `${value.slice(0, 1000)}…` : value;
}

export function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const r = redact(payload) as Record<string, unknown>;
  return Buffer.byteLength(JSON.stringify(r), "utf8") > MAX_BYTES ? { truncated: true } : r;
}

/** Returns the first secret-looking key found at any depth, or null. */
export function findSecretKey(value: unknown, path = "", depth = 0): string | null {
  if (depth > 12) return null;
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) { const f = findSecretKey(v, `${path}[${i}]`, depth + 1); if (f) return f; }
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) return `${path}${k}`;
      const f = findSecretKey(v, `${path}${k}.`, depth + 1);
      if (f) return f;
    }
  }
  return null;
}
