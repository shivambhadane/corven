# Evidence Service

**Status: planned (design).** What exists today is the foundation: the registries already keep append-only versions, status history, audit logs and dependency evidence, enforced by database triggers. Hashing, signing, chaining and anchoring are not built.

## Purpose

Produce evidence of incident analysis and response that is tamper-evident and can be verified by someone who does not trust CORVEN.

## What is recorded

Incident metadata; graph snapshot reference and hash; blast-radius result; containment plan (with its hash); approval record; execution results per action; verification result; timestamps; relevant transaction and Arkiv references. Failed and partial actions are recorded too.

## Record model

Each stage appends one `EvidenceRecord`:

| Field | Meaning |
|---|---|
| `incidentId`, `sequence` | Position in this incident's chain |
| `stage` | `incident_opened`, `impact_analysed`, `plan_proposed`, `approval_decided`, `action_executed`, `verification_recorded`, `incident_resolved` |
| `payload` | Structured content (no secrets) |
| `payloadHash` | SHA-256 of the canonical payload |
| `previousHash` | Hash of the previous record, or a fixed genesis value |
| `recordHash` | SHA-256 over `(sequence, stage, payloadHash, previousHash, createdAt)` |
| `signature`, `signerKeyId` | Signature over `recordHash` |
| `anchors` | Optional Arkiv and chain references with their status |
| `status` | `recorded`, `submitted`, `anchored`, `anchor_failed` |

Canonicalization uses a deterministic JSON form (sorted keys, no insignificant whitespace; RFC 8785 JCS is the proposed standard) so the same content always hashes the same.

## Rules

- Append-only: no update or delete, enforced in the database as for existing history tables.
- Evidence is generated for every completed stage, including failures.
- **Submitted is not verified.** A record whose anchor is only submitted stays `submitted` until confirmed; a failed anchor is shown as such.
- Verification status is computed by actually checking, never assumed from storage.
- Evidence references must be retrievable.

## Decisions needed

| Decision | Notes |
|---|---|
| Who owns the signing key, and where is it kept? | Unspecified. Must not live in the repository or ordinary environment files |
| Signature scheme | Proposal: Ed25519; on-chain verification may suggest secp256k1 instead |
| What exactly is anchored on-chain? | Proposal: the chain head hash per incident, not the payloads |
| What goes to Arkiv? | Incident snapshots and plan/outcome records, following Arkiv's ownership model (to be confirmed against its documentation) |

## Planned API

`GET /api/v1/incidents/:id/evidence`, `GET /api/v1/evidence/:id`, `POST /api/v1/evidence/verify` (verify a chain, returning which checks passed). Permission: `evidence:read`.

## Errors

`EVIDENCE_CHAIN_BROKEN`, `EVIDENCE_SIGNATURE_INVALID`, `ANCHOR_PENDING` and `ANCHOR_FAILED` as statuses in verification results.

## Tests to write

Canonicalization stability; chain verification; detection of a modified payload, reordered records and a removed record; signature failure; failed anchoring is visible; append-only triggers; tenant isolation.

See [engineering/07-evidence-verification.md](../engineering/07-evidence-verification.md) for the verification procedure.
