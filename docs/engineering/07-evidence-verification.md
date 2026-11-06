# Evidence Verification

**Status: planned (design).** This is the procedure an independent party would follow to check CORVEN's incident evidence. It depends on the Evidence Service, which is not built. See [modules/10-evidence-service.md](../modules/10-evidence-service.md) for the record model.

## What "verified" means

A record is **verified** only if its integrity was actually checked. Merely being stored, submitted to a chain or present in Arkiv is not verification. The product keeps `recorded`, `submitted`, `anchored` and `verified` distinct.

## What a verifier needs

1. The incident's evidence records, in sequence.
2. The public signing key(s) for `signerKeyId` (published or obtained out of band).
3. Optionally the chain transaction and the Arkiv entry that anchor the chain head.
4. The canonicalization specification (deterministic JSON, proposed RFC 8785 JCS) and the hash function (SHA-256).

It does **not** need access to CORVEN's database or to trust its API.

## Procedure

For each record in order, starting at sequence 0:

1. **Payload hash:** canonicalize `payload`, hash it, compare with `payloadHash`.
2. **Record hash:** recompute `recordHash` from `(sequence, stage, payloadHash, previousHash, createdAt)` and compare.
3. **Chain link:** `previousHash` must equal the prior record's `recordHash` (or the documented genesis value for sequence 0).
4. **Sequence:** sequences are contiguous with no gaps or repeats.
5. **Signature:** verify the signature over `recordHash` with the signer key; check the key was valid at `createdAt`.

Then, for the chain as a whole:

6. **Anchor:** if an anchor exists, check that the on-chain (or Arkiv) value equals the head `recordHash`, and that the transaction is confirmed.
7. **Cross-references:** referenced artifacts (plan hash, graph snapshot hash, approval record) match the hashes stored in the records that mention them.

## Outcomes

| Result | Meaning |
|---|---|
| `verified` | Steps 1 to 5 pass for every record and the anchor (if claimed) matches |
| `verified_unanchored` | Chain and signatures pass; no anchor yet or anchor still pending |
| `broken` | A hash, link, sequence or signature check failed; the first failing record and check are reported |
| `incomplete` | Records missing or a required artifact unavailable |

A removed or reordered record shows up as a sequence gap or a broken link; an edited payload shows up at step 1; a forged record fails the signature.

## What verification does not prove

- That the recorded facts are true (a compromised producer could sign false facts); it proves they were not altered afterwards.
- That every event was recorded; completeness depends on the instrumented stages.
- That the signing key was never compromised.

## What exists today

Append-only enforcement at the database level for the registries' versions, audit logs and dependency evidence. There is no hashing, chaining, signing or anchoring yet, so no tamper-evidence against a privileged database user. The planned tests are listed in the Evidence Service document.

## Open decisions

Signing key custody and scheme; whether to anchor per stage or per incident; the exact record hash preimage and genesis value. These must be fixed before the first evidence record is written, because they cannot be changed for existing records.
