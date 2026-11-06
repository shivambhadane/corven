# Evidence Service

**Status: implemented and tested, with external anchoring behind interfaces.** Code: `apps/api/src/modules/evidence-service`.

| Piece | State |
|---|---|
| Canonical, schema-versioned incident record, SHA-256, hash chain per incident | Real |
| Integrity verification (hash, chain, sealed sources unchanged, anchors) | Real |
| Arkiv publication | **Interface and in-memory test double only. No Arkiv client exists.** |
| Ethereum anchoring: read side (receipt, confirmations, data check) | Real JSON-RPC client, tested against a fake transport; **never run against a live node** |
| Ethereum anchoring: submitting a transaction | **Interface only.** Needs a signer (key management) that does not exist; without it a submit fails and the anchor is recorded `failed` |
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
