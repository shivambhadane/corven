import { createHash } from "node:crypto";

/** Deterministic JSON: object keys sorted recursively, dates as ISO strings, no whitespace. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, norm(x)]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/** SHA-256 of the canonical JSON form. */
export const canonicalHash = (value: unknown): string => sha256Hex(canonicalJson(value));
