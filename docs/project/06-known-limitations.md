# Known Limitations

Consolidated list. The PRD requires CORVEN not to claim more than it does; this is the single place to check. Status as of 6 November 2026. Each item says whether it is a product limit (by design), an implementation gap, or a pending decision.

## Product limits (by design)

CORVEN **does not and cannot**:

1. Control every external agent or resource. It enforces only on operations routed through its own enforcement points.
2. Revoke independent credentials or permissions outside its enforcement boundary.
3. Reverse completed blockchain transactions.
4. Guarantee its graph contains every dependency. The absence of a discovered relationship is not proof none exists; a recorded relationship may not currently be in use.
5. Treat an AI-generated recommendation as automatically safe. No language model approves, enforces or decides anything.
6. Treat a submitted transaction as successful containment.
7. Call a recorded incident independently verified unless its integrity was actually checked.
8. Treat graph reachability as compromise or as an exploitable path.

The product must distinguish planned, approved, submitted, executed and verified containment.

## Security gaps (must fix before any public deployment)

| Gap | Detail |
|---|---|
| **No real authentication, users or organizations** | Only a fail-closed default and a development header adapter. `organization_id` has no foreign key |
| No rate limiting | |
| No CI, dependency or secret scanning | Checks run locally only |
| Metadata secret detection is name-based | A secret under an innocent key passes |
| Tamper-evidence limited to database triggers | A database superuser can bypass them; hashing, signing and anchoring are not built |
| No TLS, secrets management or hardening procedure | |

## Implementation gaps by module

| Module | Gap |
|---|---|
| Agent Registry | No agent deletion; no audit read endpoint; identity verification (ENS) not implemented, only the internal entry point; capabilities are descriptive strings; `incident_id` on history is not validated |
| Dependency Registry | Resources can only be created and read (no update, removal or audit); `resource → resource` and workflows as first-class entities unsupported; per-type metadata rules (`scope`, `accessLevel`) are an MVP convention; soft removal only; observed-again inactive dependencies need a human to reactivate; `last_verified_at` can run ahead of the latest version snapshot by design |
| Graph Engine | Rebuilt per request (no cache); limit of 50,000 nodes and 250,000 edges; weak connectivity only is exposed; path and cycle enumeration are bounded and may report truncation; reflects registered dependencies only |
| Dependency Discovery | Built for three source types with documents supplied inline; no live crawling or scheduling; runtime events are not authenticated as coming from a real gateway; confidence and the 0.8 threshold are policy values |
| Graph Snapshots | Not signed or anchored; no retention or deletion policy; `incident_id` unvalidated |
| Blast radius, containment | Built. Reachability is structural; inherited authority not modelled; workflow preservation sound but incomplete; plans are advisory and assume every edge is controllable until the gateway reports coverage |
| Incident Management | Built. No user or membership model (assignees are only UUID-checked); development auth only; analysis stored as verifiable references, not full results; no external event bus yet |
| Authorization & Enforcement Gateway | Built. Executors simulated; no on-chain adapter; no enforcement for authority or operational edges; no mTLS or rate limiting; symmetric token key; approval check is a port until the Approval Service exists |
| Approval Service | Built. Approver identity comes from the development authenticator; approvals are not signed; no notifications; the expiry/reconciliation sweep is not scheduled yet (also applied lazily) |
| Verification Service | Built. Probes use simulated executors; negative tests show only what the gateway allows; path checks cover only registered dependencies; runs are synchronous and a crash leaves a `running` row that must be cleared |
| Orchestration | Built. Approvals are noticed on the next tick (up to a minute) unless nudged; one workflow per incident; no outbound event stream or dead-letter queue (failures stay visible as `failed` workflows); detection sources enter in-process only (no authenticated detector API) |
| Evidence Service | Built. **Arkiv: no client, test double only. Ethereum: read-side JSON-RPC client untested against a node; transaction submission/signing not built. ENS: no live resolution.** Records are hashed and chained but not signed. Anchoring and confirmation polling are manual calls. |
| Contracts, ENS, Arkiv, Chainlink CRE | Not built; sponsor technologies not yet reviewed in detail |
| Dashboard | Not built; static landing page only |
| Operations | Health check does not touch the database; no metrics or alerting; no cloud deployment |

## Design limits to keep visible

- Containment's workflow preservation is **sound but not complete**: a returned plan satisfies its constraints in the model, but a feasible plan may be missed. See [modules/06-containment-engine.md](../modules/06-containment-engine.md).
- Verification proves behavior only for what was tested, at a point in time.
- Evidence verification shows records were not altered; it does not prove the recorded facts are true.
- Confidence scores are source-based policy values, not calibrated probabilities.

## Pending decisions that affect scope

Gateway placement; permission source of truth (database or chain); Chainlink CRE direction; evidence signing key custody; inherited-authority semantics for blast radius; how healthy workflows are specified. Listed in [architecture/01-system-architecture.md](../architecture/01-system-architecture.md).

## Operational limits

- Performance is measured only for the Graph Engine at 1,000 nodes and 5,000 edges; other numbers are not claimed.
- The Sepolia testnet is unstable and has no value guarantees.
- Cloud costs are bounded by about $100 of AWS credits, subject to eligibility and expiry.

## Keeping this current

Update this file in the same change that closes or opens a limitation. The landing page status table and the README must match it.
