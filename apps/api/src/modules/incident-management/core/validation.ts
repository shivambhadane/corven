const SECRET_KEY = /(pass(word|phrase)?|secret|token|private[_-]?key|api[_-]?key|mnemonic|seed[_-]?phrase|credential|authorization|bearer)/i;
const SECRET_VALUE: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key block"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, "an AWS access key id"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i, "a bearer token"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, "a JSON web token"],
  [/\b0x[0-9a-fA-F]{64}\b/, "a 32-byte hex value that may be a private key"],
  [/\b(?:sk|pk|rk)[-_](?:live|test)?[-_]?[A-Za-z0-9]{20,}/, "an API key"],
  [/\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S{6,}/i, "an inline credential"],
];

/** Best-effort guardrail, not a scanner: names what looks like a secret so the author can remove it. */
export function findSecretInText(text: string): string | null {
  for (const [re, what] of SECRET_VALUE) if (re.test(text)) return what;
  return null;
}

/** Returns the path (for example `list[1].note`) of the first secret-looking key or value in structured data, or null. */
export function findSecretInData(value: unknown, path = "", depth = 0): string | null {
  if (depth > 10) return null;
  if (typeof value === "string") return findSecretInText(value) ? path || "(value)" : null;
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      const f = findSecretInData(v, `${path}[${i}]`, depth + 1);
      if (f) return f;
    }
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const here = path ? `${path}.${k}` : k;
      if (SECRET_KEY.test(k)) return here;
      const f = findSecretInData(v, here, depth + 1);
      if (f) return f;
    }
  }
  return null;
}

const CORRELATION = /^[A-Za-z0-9._:-]{1,100}$/;
/** Correlation ids are echoed into logs and history, so only a safe alphabet is accepted; anything else is replaced. */
export const safeCorrelationId = (v: string | undefined, fallback: string): string => (v && CORRELATION.test(v) ? v : fallback);

export const MAX_EVENT_DATA_BYTES = 8 * 1024;
export const dataSize = (v: unknown): number => Buffer.byteLength(JSON.stringify(v ?? null), "utf8");
