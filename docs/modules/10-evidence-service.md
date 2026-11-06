# Evidence Service (index)

**Status: implemented and tested; Arkiv and Ethereum are interfaces with test doubles (a read-only JSON-RPC Ethereum client exists but has never run against a node).** Documentation: [evidence-service/](evidence-service/README.md).

Canonical, schema-versioned incident records sealed with SHA-256 and chained per incident; free text kept out; verification against the append-only sources and external anchors; anchoring publishes only the hash, and an anchor counts only after read-back (Arkiv) or after a successful, hash-carrying, sufficiently confirmed transaction (Ethereum). Anchoring failures never invalidate a record.

Not built: Arkiv client, transaction signing/submission, live ENS resolution, record signing, scheduled anchoring and confirmation polling.
