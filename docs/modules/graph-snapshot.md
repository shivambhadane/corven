# Graph Snapshot Service

**Status: implemented and tested.** Code: `apps/api/src/modules/graph-snapshot`. Authentication is still the development-only adapter.

## Purpose

Freeze the dependency graph of one organization at a moment in time, so an incident analysis can later be replayed against exactly the graph that was analysed, even after the registries change.

## Scope

- Stores the Graph Engine export (all edge statuses, including inactive) as an immutable record with a SHA-256 content hash.
- Lists, reads, verifies and diffs snapshots.
- Lets Blast-Radius and Containment run against a snapshot (`snapshotId`) instead of the live registries.

Not in scope: scheduling snapshots, retention or deletion, restoring a snapshot into the registries, and signing or anchoring the hash outside the database.

## Design

1. **Creation** builds the graph from one read-only `REPEATABLE READ` view (the Graph Engine's normal path) and stores `export(graph)` as `payload` jsonb, with node and edge counts.
2. **Content hash:** SHA-256 over the canonical JSON (sorted keys, no whitespace) of the payload with `builtAt` removed, so two builds of an unchanged registry hash identically (`src/common/canonical.ts`).
3. **Integrity:** the hash is recomputed on every load. A mismatch raises `SNAPSHOT_INTEGRITY_FAILED` (500, generic message; detail goes to the server log). Analyses never run on a snapshot that fails verification.
4. **Immutability:** `UPDATE`, `DELETE` and `TRUNCATE` on `graph_snapshots` are rejected by `corven_reject_mutation()` (SQLSTATE 23001). A database superuser can still bypass triggers; the hash makes that detectable but not impossible.
5. **Diff** compares two snapshots by node and edge id and reports added, removed and changed ids with the **names** of changed fields, not their values.
6. **Tenancy:** the organization comes from the principal only. A snapshot in another organization is a 404.

## API

All under `/api/v1/graph/snapshots`. Reads need `snapshot:read`, creation needs `snapshot:write`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/` | Create. Body `{label?, incidentId?}` (unknown fields are a 400). 201 |
| GET | `/` | List, newest first. `page`, `limit` (≤100), `incidentId` |
| GET | `/:snapshotId` | Metadata (no payload) |
| GET | `/:snapshotId/graph` | Metadata plus stored nodes and edges (verified first) |
| GET | `/:snapshotId/verify` | Recompute the hash and report whether it matches |
| GET | `/:fromId/diff/:toId` | Added, removed and changed nodes and edges |

Errors: `SNAPSHOT_NOT_FOUND` 404, `SNAPSHOT_INTEGRITY_FAILED` 500, 400 for validation, 403 for missing permission.

## Data

`graph_snapshots`: `id`, `organization_id`, `label`, `incident_id` (no FK yet; incidents do not exist), `created_by`, `node_count`, `edge_count`, `content_hash` (CHECK length 64), `payload` jsonb, `built_at`, `created_at`. Unique `(id, organization_id)`. Migrations `0006_graph_snapshots` and `0007_snapshot_append_only`, with down scripts.

## Limitations

- Snapshots are not signed or anchored; tamper-evidence is a database hash plus triggers.
- No retention policy: each snapshot stores the full graph. At the 50,000 node / 250,000 edge cap that is large.
- `incident_id` is an unvalidated reference until the Incident module exists.
- A snapshot records only what was registered or discovered at that time.

## Tests

`apps/api/test/graph-snapshot.test.ts`: creation, stable hash, tamper detection, append-only triggers, diff, tenancy, permissions, validation.
