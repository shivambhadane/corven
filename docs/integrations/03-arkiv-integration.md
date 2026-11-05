# Arkiv Integration

**Status: planned (design).** Nothing is implemented, and **the Arkiv API, data model and ownership rules have not been reviewed here**. The PRD requires real writes and reads that follow Arkiv's own data and ownership model; confirm those details against Arkiv's current documentation and the hackathon requirements before writing code.

## Purpose (from the PRD)

- Store incident snapshots, plans and outcomes.
- Store dependency or delegation records where appropriate.
- Retrieve historical incident records, with user-visible querying of stored evidence.
- Keep verifiable references to records, and make the stored records useful to the incident workflow.

Arkiv is **additional persistence and verifiability**, not the source of truth. PostgreSQL remains authoritative for application state.

## Adapter interface (proposed)

```ts
interface ArkivAdapter {
  put(record: ArkivRecord): Promise<ArkivReference>;     // returns a reference, with write status
  get(reference: ArkivReference): Promise<ArkivRecord | null>;
  query(filter: ArkivQuery): Promise<ArkivRecord[]>;
}
```

A fake adapter serves unit tests; integration tests need a real or sandboxed Arkiv endpoint.

## What would be stored

Per incident: the evidence chain head and records ([modules/10-evidence-service.md](../modules/10-evidence-service.md)), the graph snapshot export, the containment plan and its hash, and the outcome. Content is the canonical, hash-addressed form so a reader can check it against the on-chain or database hash. No secrets, credentials or unrestricted runtime payloads.

## Rules

- A write is `submitted` until confirmed, then `stored`; a failed write is recorded and retried, and the incident flow continues with the gap visible. Arkiv outages must not block containment.
- Reads validate the content hash before trusting it.
- Stored records are immutable from CORVEN's side; corrections are new records that reference the old one.
- Ownership and access follow Arkiv's model (to be confirmed), and tenant separation is applied before anything is written.

## Testing

Write success, write failure and retry, read of a missing or tampered record (hash mismatch), query filters, outage during an incident.

## Open questions

Exact data model and ownership rules; query capabilities available for the evidence viewer; cost and rate limits; how references are represented in evidence records.
