# Cryptography

- **Canonical JSON** (`common/canonical.ts`): object keys sorted recursively, no insignificant whitespace, UTF-8. The same function seals and verifies, and also serves snapshot and approval hashes.
- **Hash:** SHA-256 over the canonical document, stored as 64 hex characters (`content_hash`). The database checks the format.
- **Chain:** each record carries `previous: { evidenceId, contentHash }` **inside** the hashed document and in `previous_hash`. Altering an earlier record changes its hash and breaks every later link; verification of any record re-hashes its predecessor.
- **Not signed.** There is no CORVEN signing key (key ownership and storage are an open decision), so records prove integrity relative to a trusted hash, not authorship. Anchoring the hash externally is what fixes it at a point in time independently of CORVEN's database.
- **No hash of secrets.** Free text is hashed only as described in the schema document.
- **Database-level tampering** (a privileged user disabling triggers and editing both content and hash together) is caught by the chain only for earlier records, by external anchors for anchored ones, and by the comparison with the append-only sources. A record that was altered *and* re-hashed *and* never anchored is detected only through the source comparison.
