# Evidence Service

**Status: implemented and tested, with external anchoring behind interfaces.** Code: `apps/api/src/modules/evidence-service`.

| Piece | State |
|---|---|
| Canonical, schema-versioned incident record, SHA-256, hash chain per incident | Real |
| Integrity verification (hash, chain, sealed sources unchanged, anchors) | Real |
| Arkiv publication | **Implemented with the official SDK 1.0.1 and tested on the Rabdi testnet** (create, read back, query, verify, reconcile). A valid access key has not been tested; see [arkiv-integration.md](arkiv-integration.md) |
| Ethereum anchoring: read side (receipt, confirmations, data check) | Real JSON-RPC client, tested against a fake transport; **never run against a live node** |
| Ethereum anchoring: submitting a transaction | **Implemented in `ViemEthereumAnchor` and tested against a local Anvil chain with a deployed copy of the contract. Not deployed to Sepolia; not wired into the server's startup.** See [ethereum-integration.md](ethereum-integration.md) |
| ENS | Identity references are recorded as registered; **no live ENS resolution** |

## Purpose

A tamper-evident record of an incident and its response: what happened, who approved which exact plan, what was enforced, and what verification observed. A reviewer can recompute its hash, check its chain, check it against the append-only source records, and check external anchors.

## What a hash does and does not prove

A matching hash proves the record has not changed since it was sealed. It does **not** prove that the recorded events were genuine or that the people named are who they claim to be (human authentication is still the development adapter). Every record says so in its `limitations`.

## Documents

| Document | Contents |
|---|---|
| [architecture.md](architecture.md) | Components, lifecycle, flows |
| [evidence-schema.md](evidence-schema.md) | The sealed document |
| [cryptography.md](cryptography.md) | Canonicalization, hashing, chain |
| [arkiv-integration.md](arkiv-integration.md) | Arkiv adapter |
| [ethereum-integration.md](ethereum-integration.md) | Ethereum adapter and confirmation rules; ENS |
| [verification.md](verification.md) | How a reviewer verifies |
| [api.md](api.md) | Endpoints |
| [testing.md](testing.md) | Tests |
