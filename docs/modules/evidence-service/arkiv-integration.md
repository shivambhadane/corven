# Arkiv

**Not integrated.** There is an `ArkivClient` interface (`publish`, `fetch`) and an in-memory test double. No Arkiv SDK or endpoint is wired in, and nothing here has been tested against Arkiv.

## What would be published

Only `{ evidenceId, contentHash, schemaVersion, sequence }`. Never incident content, titles or agent data (tested: the published entity contains no incident text).

## Rules the service applies to any client

- An Arkiv anchor is `confirmed` only if the record **read back** from the entity key has the same content hash and evidence id. Otherwise it is `failed` with an explanation.
- Errors (unavailable, timeout) mark that anchor `failed`; the evidence record stays valid, and `POST /evidence/:id/anchor` retries (attempt counter increments). A confirmed anchor is not published again.
- Verification re-fetches the entity and reports `failed` if it is missing or its hash differs; the internal record's validity is unaffected.
- Arkiv is never required for local evidence generation.

To integrate: implement `ArkivClient` for the real service and pass it in `evidenceConfig.arkiv`. Retention, access control and entity expiry on the Arkiv side must be reviewed then.
