import { ValidationError } from "../../../errors.js";
import type { IdentityType } from "../types/agent.types.js";

const MAX_METADATA_BYTES = 8 * 1024;
const MAX_METADATA_DEPTH = 5;
const MAX_CAPABILITIES = 100;
const MAX_IDENTITIES = 20;

/** Best-effort guard, not a secret scanner. Rejects obviously secret-named keys. */
const SECRET_KEY = /(pass(word|phrase)?|secret|token|private[_-]?key|api[_-]?key|mnemonic|seed[_-]?phrase|credential|authorization|bearer)/i;

export function assertSafeMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new ValidationError("metadata must be an object");
  }
  const size = Buffer.byteLength(JSON.stringify(metadata), "utf8");
  if (size > MAX_METADATA_BYTES) {
    throw new ValidationError(`metadata must not exceed ${MAX_METADATA_BYTES} bytes`);
  }
  const walk = (value: unknown, depth: number, path: string): void => {
    if (depth > MAX_METADATA_DEPTH) throw new ValidationError("metadata is nested too deeply");
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, depth + 1, `${path}[${i}]`));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (SECRET_KEY.test(k)) {
          throw new ValidationError(
            `metadata key "${path}${k}" looks like a secret; do not store secrets in agent metadata`,
          );
        }
        walk(v, depth + 1, `${path}${k}.`);
      }
    }
  };
  walk(metadata, 0, "");
  return metadata as Record<string, unknown>;
}

const CAPABILITY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** Normalises (trim + lowercase), validates, dedupes and sorts capabilities. */
export function normalizeCapabilities(input: readonly string[]): string[] {
  if (input.length > MAX_CAPABILITIES) {
    throw new ValidationError(`An agent may have at most ${MAX_CAPABILITIES} capabilities`);
  }
  const out = new Set<string>();
  for (const raw of input) {
    const cap = raw.trim().toLowerCase();
    if (cap.length > 100 || !CAPABILITY.test(cap)) {
      throw new ValidationError(
        `Invalid capability "${raw.slice(0, 40)}": use dotted lowercase names like "customer.read"`,
      );
    }
    out.add(cap);
  }
  return [...out].sort();
}

export interface IdentityInput {
  identityType: IdentityType;
  identityValue: string;
  chainId?: number | null | undefined;
}

export interface NormalizedIdentity {
  identityType: IdentityType;
  identityValue: string;
  chainId: number | null;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ENS_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function normalizeIdentities(input: readonly IdentityInput[]): NormalizedIdentity[] {
  if (input.length > MAX_IDENTITIES) {
    throw new ValidationError(`An agent may have at most ${MAX_IDENTITIES} identities`);
  }
  const seen = new Set<string>();
  const out: NormalizedIdentity[] = [];
  for (const i of input) {
    let value = i.identityValue.trim();
    if (value.length === 0) throw new ValidationError("identityValue must not be blank");
    if (i.identityType === "evm_address") {
      if (!EVM_ADDRESS.test(value)) throw new ValidationError("evm_address must be a 0x-prefixed 20-byte hex address");
      value = value.toLowerCase();
    } else if (i.identityType === "ens") {
      value = value.toLowerCase();
      if (!ENS_NAME.test(value)) throw new ValidationError("ens identity must be a valid ENS name");
    }
    const chainId = i.chainId ?? null;
    const key = `${i.identityType}|${value.toLowerCase()}|${chainId ?? 0}`;
    if (seen.has(key)) throw new ValidationError("Duplicate identity in request");
    seen.add(key);
    out.push({ identityType: i.identityType, identityValue: value, chainId });
  }
  return out;
}
