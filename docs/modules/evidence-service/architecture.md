# Evidence architecture

```mermaid
flowchart LR
  subgraph Sources[append-only source records, read only]
    INC[incident, history, timeline, notes, analysis refs, associations]
    APP[approvals + decisions]
    ENF[enforcement actions + events]
    VER[verification runs]
    IDN[agent identities]
  end
  Sources -->|one REPEATABLE READ snapshot| GEN[generate]
  GEN --> DOC[canonical document] --> SEAL[SHA-256 + chain] --> DB[(evidence_records)]
  DB --> VFY[verify]
  DB --> ANC[anchor]
  ANC -->|hash + ids only| ARK[Arkiv client]
  ANC -->|hash in tx data| ETH[Ethereum client]
  ARK & ETH --> ANCH[(evidence_anchors)]
  VFY -->|re-read sources, re-check anchors| Sources & ARK & ETH
```

## Lifecycle

```mermaid
stateDiagram-v2
  [*] --> sealed: generate (collecting happens inside one transaction)
  sealed --> anchor_pending: anchor submitted
  anchor_pending --> anchored: all anchors confirmed
  anchor_pending --> anchor_failed: an anchor failed
  anchor_failed --> anchor_pending: retry
  anchored --> verified: verify passes
  sealed --> verified: not reachable without anchors
  sealed --> invalid: verification fails
  anchored --> invalid: verification fails
  anchor_pending --> invalid: verification fails
```

`COLLECTING` and `GENERATED` from the brief happen inside the generating transaction and are not persisted states: a record either exists sealed or does not. `invalid` is terminal (database trigger). An anchoring failure never moves a record to `invalid`; it only affects the anchoring status.

## Behaviour

- **Consistency:** all sections are read in one `REPEATABLE READ` transaction, so they describe the same moment. Concurrent generation is serialized by the unique `(incident, sequence)` and retried.
- **Immutability:** `content`, `content_hash`, sequence and chain links are frozen by a trigger; nothing is deleted; verification logs are append-only.
- **A later record, not an edit:** the incident keeps moving after sealing. New activity goes in the next record, whose `previous` links to this one. Verification of an older record accepts later additions and rejects changes to what was sealed.
- **Timeline:** generating a record writes an `evidence.generated` event to the incident timeline (best effort; the record exists regardless).
