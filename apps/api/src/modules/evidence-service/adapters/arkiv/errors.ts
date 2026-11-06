/** Operational error codes for Arkiv, each with a retry policy. Messages never contain keys, URLs or request bodies. */
export type ArkivErrorCode =
  | "ARKIV_DISABLED"
  | "ARKIV_NOT_CONFIGURED"
  | "ARKIV_AUTH_FAILED"
  | "ARKIV_WRONG_NETWORK"
  | "ARKIV_RATE_LIMITED"
  | "ARKIV_QUOTA_EXCEEDED"
  | "ARKIV_TIMEOUT"
  | "ARKIV_NETWORK"
  | "ARKIV_INSUFFICIENT_FUNDS"
  | "ARKIV_TX_FAILED"
  | "ARKIV_NOT_INDEXED"
  | "ARKIV_READBACK_MISMATCH"
  | "ARKIV_MALFORMED_ENTITY"
  | "ARKIV_INVALID_ENTITY"
  | "ARKIV_UNKNOWN";

/** Permanent failures need a human or a configuration change; retrying them in a loop is pointless. */
const RETRYABLE: Record<ArkivErrorCode, boolean> = {
  ARKIV_DISABLED: false, ARKIV_NOT_CONFIGURED: false, ARKIV_AUTH_FAILED: false, ARKIV_WRONG_NETWORK: false,
  ARKIV_READBACK_MISMATCH: false, ARKIV_MALFORMED_ENTITY: false, ARKIV_INVALID_ENTITY: false,
  ARKIV_RATE_LIMITED: true, ARKIV_QUOTA_EXCEEDED: true, ARKIV_TIMEOUT: true, ARKIV_NETWORK: true, ARKIV_INSUFFICIENT_FUNDS: true, ARKIV_TX_FAILED: true, ARKIV_NOT_INDEXED: true, ARKIV_UNKNOWN: true,
};

export class ArkivError extends Error {
  readonly retryable: boolean;
  constructor(readonly code: ArkivErrorCode, message: string) {
    super(message);
    this.name = "ArkivError";
    this.retryable = RETRYABLE[code];
  }
}

export const isArkivError = (e: unknown): e is ArkivError => e instanceof ArkivError;

/**
 * Reduces any SDK, viem or fetch failure to a classified ArkivError with a short generic message. The original message is
 * dropped on purpose: SDK and transport errors can embed URLs, headers or request bodies.
 */
export function classifyArkivError(e: unknown): ArkivError {
  if (isArkivError(e)) return e;
  const x = e as { name?: string; status?: number; shortMessage?: string; message?: string; details?: string; cause?: unknown };
  const text = `${x.name ?? ""} ${x.shortMessage ?? ""} ${x.message ?? ""} ${x.details ?? ""} ${String((x.cause as { message?: string } | undefined)?.message ?? "")}`.toLowerCase();
  const status = x.status ?? (x.cause as { status?: number } | undefined)?.status;
  if (status === 401 || status === 403 || /invalid_key|unknown api key|unauthori[sz]ed|missingaccesskey/.test(text)) return new ArkivError("ARKIV_AUTH_FAILED", "Arkiv rejected the access key");
  // Rabdi's anonymous (key-less) budget, or a key's monthly quota: waiting helps, but only a key or a bigger quota fixes it for good.
  if (/anon_cost_limited|query budget|quota (exceeded|exhausted)/.test(text)) return new ArkivError("ARKIV_QUOTA_EXCEEDED", "The Arkiv query budget is exhausted (use an Arkiv Hub access key, or wait for the quota to reset)");
  if (status === 429 || /rate.?limit|too many requests/.test(text)) return new ArkivError("ARKIV_RATE_LIMITED", "Arkiv rate limit reached");
  if (/insufficient funds|insufficient balance|exceeds the balance|gas required exceeds/.test(text)) return new ArkivError("ARKIV_INSUFFICIENT_FUNDS", "The Arkiv signer has too little tGLM");
  if (/timeout|timed out|aborterror|etimedout/.test(text)) return new ArkivError("ARKIV_TIMEOUT", "The Arkiv request timed out");
  if (/noentityfound/.test(text)) return new ArkivError("ARKIV_NOT_INDEXED", "The entity was not found (not yet indexed, expired or deleted)");
  if (/schemamismatch|invalidvalue|entitytoolarge|toomanyattributes|invalidattribute|invalidexpiry/.test(text)) return new ArkivError("ARKIV_INVALID_ENTITY", "The entity was rejected as invalid by the SDK");
  if (/entitymutationerror|reverted|execution reverted/.test(text)) return new ArkivError("ARKIV_TX_FAILED", "The Arkiv transaction failed");
  if (/econnrefused|enotfound|econnreset|fetch failed|network error|socket|unreachable|bad gateway|service unavailable/.test(text) || (status !== undefined && status >= 500)) return new ArkivError("ARKIV_NETWORK", "Arkiv could not be reached");
  return new ArkivError("ARKIV_UNKNOWN", "Unexpected Arkiv error");
}

/** Bounded exponential backoff: 30 s, 1 min, 2 min, ... capped at 30 min; insufficient funds waits longer. */
export function backoffMs(attempt: number, code: ArkivErrorCode): number {
  const base = code === "ARKIV_INSUFFICIENT_FUNDS" || code === "ARKIV_QUOTA_EXCEEDED" ? 5 * 60_000 : 30_000;
  return Math.min(base * 2 ** Math.max(0, attempt - 1), 30 * 60_000);
}
export const MAX_ARKIV_ATTEMPTS = 6;
