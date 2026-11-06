# Verifying evidence

`POST /evidence/:id/verify` (and any reviewer, by hand) performs:

| Step | Check | Failure means |
|---|---|---|
| `content_hash` | Recompute SHA-256 of the canonical content; compare with the stored hash | The record was altered |
| `schema_version` | The version is supported | Unknown format |
| `chain` | The predecessor exists, its hash equals `previous_hash`, and its own content re-hashes correctly | An earlier record was altered or removed |
| `binding` | The document's id, incident, organization and sequence match the row | The row was altered or moved |
| `sources_unchanged` | Re-read the source records: everything sealed is still present and identical (state history, associations, analysis references, approvals and their decisions, enforcement actions and their history, verification results, the sealed prefix of the timeline and notes). Later additions are allowed; status fields that legitimately move are not compared, but an enforcement status must agree with its own history | A source record was changed after sealing |
| `anchor_arkiv`, `anchor_ethereum` | Re-read the external record or transaction | `failed`: it is missing or disagrees. `unavailable`: could not be checked, or not enough confirmations yet |

**Result:** `valid` is true when all internal steps pass. A failed internal step makes the record `invalid` permanently. External mismatches are reported but do not invalidate the internal record. If every anchor is confirmed, the record becomes `verified`.

Every verification is appended to `evidence_verification_logs` (who, when, each step). `sources_unchanged` can be `unavailable` if the database read fails; that is not a pass.

## An independent reviewer without CORVEN

1. Fetch the record (`GET /evidence/:id`); canonicalize `content` (sorted keys, no whitespace) and SHA-256 it; compare with `contentHash`.
2. Follow `previous` and repeat.
3. Look up the Ethereum transaction: its input must contain `contentHash` and it must be deeply confirmed.
4. Fetch the Arkiv entity and compare the hash.
5. Compare approval digests and plan hashes with the independent plan and snapshot hashes.

Steps 3 and 4 depend on integrations that are not live yet.
