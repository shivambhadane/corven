# ENS Integration

**Status: planned (design).** The registry fields it will use already exist: agent identities with type `ens` and a `verificationStatus` that is `unverified` by default, and an internal admin-gated `recordVerification` operation that is deliberately not exposed over HTTP. No ENS resolution is implemented.

## Purpose

Represent agent identities through ENS names, explore hierarchical agent identities (for example agents as subnames of an organization name), and tie identity information to ownership and delegation in a way that connects to real CORVEN enforcement.

## Important limits

- **Registering or owning an ENS name does not revoke wallet, API or database permissions.** The integration must connect identity to an actual enforcement mechanism, or it is decoration.
- A resolved ENS name does not prove runtime integrity or that the agent running is the one named.
- An unverified identity must never be displayed as verified.

## Adapter interface

```ts
interface EnsAdapter {
  resolveAddress(name: string): Promise<{ address: string | null; resolvedAt: Date }>;
  getTextRecord(name: string, key: string): Promise<string | null>;
  getOwner(name: string): Promise<string | null>;
}
```

Behind it: an RPC provider and a resolver library. A fake adapter serves tests.

## Verification flow (proposed)

1. An agent has an identity `{ type: "ens", value: "support.acme.eth" }`, stored `unverified`.
2. A verifier job resolves the name and compares it with what CORVEN expects (for example the agent's registered wallet address, or a text record containing the agent's id).
3. On a match it calls the existing `recordVerification(…, "verified")` (admin-gated, audited), setting `verified_at`. On a mismatch it records `failed`; if resolution is unavailable it leaves the status unchanged and records the attempt.
4. Verification expires: re-resolve periodically, because ENS records change.

## Hierarchical identities (to explore)

Subnames under an organization name could encode ownership and delegation (`payment.support.acme.eth`). Whether they map to authority dependencies is a design question, not a decision; dependencies in the registry remain the source of truth for delegation.

## Rules

- Normalize names before use (the registry already lowercases and validates ENS-style names).
- Treat every response from the network as untrusted input; validate it.
- Failures (RPC unavailable, no resolver, expired name) are reported and never treated as verification.
- No ENS write is performed by default.

## Testing

Resolution success, mismatch, expired name, no resolver, RPC failure, name changes between verifications, normalization edge cases.

## To confirm before building

ENS capabilities relevant to access control and lifecycle (subname registry, wrapper permissions, expiry behavior) should be confirmed against the current ENS documentation and the hackathon sponsor requirements. This document does not assert them.
