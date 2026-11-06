# Threat Model

Scope: threats to **CORVEN itself** as security infrastructure (not to the agents it protects). Method: STRIDE over the trust boundaries in [architecture/06-security-architecture.md](../architecture/06-security-architecture.md). "Built" means implemented and tested; "Planned" means designed only.

## Assets

| Asset | Why it matters |
|---|---|
| Dependency inventory (agents, resources, edges, confidence) | A wrong or tampered graph misleads containment |
| Containment plans and approvals | Wrong or unauthorized plans cause damage or leave the attacker in place |
| Audit, version and evidence history | Integrity of the record is the product's promise |
| Enforcement credentials and the evidence signing key | Compromise lets an attacker act as CORVEN |
| Tenant data | Cross-tenant leakage ends trust |

## Adversaries

External attacker with network access; malicious or compromised tenant user; compromised agent trying to influence its own classification; compromised discovery source supplying false evidence; insider with database access; supply-chain attacker (dependencies).

## Threats and mitigations

| # | Threat (STRIDE) | Mitigation | State |
|---|---|---|---|
| T1 | **Spoofing:** forged identity calls the API | Real authentication | **Planned; dev adapter only today** |
| T2 | Spoofing: a client claims another organization | Organization from the principal only; unknown body fields rejected | Built |
| T3 | **Tampering:** edit or delete history | Append-only triggers; `RESTRICT` foreign keys; no mutating routes | Built (not against a DB superuser) |
| T4 | Tampering: undetected change by a privileged DB user | Hash chain, signing, external anchoring | Planned |
| T5 | Tampering: mass assignment (set status, org, version) | `additionalProperties:false`, rejected not ignored | Built |
| T6 | Tampering: forged dependency makes the graph wrong | Per-type rules, endpoint existence in the org, authority cycle prevention, provenance and confidence; discovery cannot create authority edges from weak sources | Built (partly) |
| T7 | Tampering: a compromised discovery source plants false edges | Confidence from strongest evidence, no auto-reactivation, human review for uncertain findings, a failed source never deactivates | Partly built; review planned |
| T7a | Tampering: stored graph snapshot altered after an incident | Immutable triggers; SHA-256 content hash verified on every load; analyses refuse a snapshot that fails | Built (not against a DB superuser; no signing) |
| T7b | Tampering: discovery silently removes real dependencies | Missing or stale findings are recorded, never deactivated; failed runs change nothing; inactive dependencies are not auto-reactivated | Built, tested |
| T7c | Tampering: discovery grants authority | Discovery cannot create authority edges; entities are never created from observations | Built, tested |
| T7d | Information disclosure: secrets in ingested events | Secret-looking fields redacted and payload size-limited before storage | Built, tested |
| T7e | Tampering: containment plan wrongly reported as safe | Plan re-verified after the cut; checked against brute force; workflow preservation is sound but incomplete; plan is advisory and hash-bound for future approval | Built; approval binding planned |
| T7f | Elevation: a person asserts approval, enforcement or containment on an incident | Those transitions are system-only; the system principal is unobtainable over HTTP | Built, tested |
| T7g | Tampering: incident analysis refers to an altered graph | Snapshot pinned by id and hash, re-verified on use; results carry a reproducibility hash | Built, tested |
| T7h | Spoofing: forged, stolen or replayed agent token | HS256 only with issuer/audience/expiry checks; credential row checked per request; rotation and revocation immediate; per-request idempotency | Built, tested (no mTLS, no rate limiting) |
| T7i | Elevation: revoked access used by in-flight work | Re-check before execution; permission version for conditional execution | Built; residual millisecond window documented |
| T7j | Bypass: the agent reaches the resource without the gateway | Coverage classification states what is and is not controlled; cannot be detected | Limitation, stated |
| T7k | Enforcement claimed without effect | `executed` means local state only; verification requirements listed; unsupported actions recorded as such | Built |
| T8 | **Repudiation:** denying an action | Actor on every version, audit and status row; internal actor distinguishes automation | Built |
| T9 | **Information disclosure:** cross-tenant read | Org scoping; 404 for foreign ids; composite FKs | Built, tested |
| T10 | Disclosure: SQL or stack leakage in errors | Safe messages, generic 500, cause logged server-side only | Built, tested |
| T11 | Disclosure: secrets stored in metadata or evidence | Secret-looking key guard (names only), size and depth limits | Partial |
| T12 | **Denial of service:** unbounded graph queries | Depth, path, cycle and search budget limits; graph size cap | Built |
| T13 | DoS: request floods, brute force | Rate limiting | **Planned** |
| T14 | **Elevation:** operator performs recovery or verification | Role checks; every exit from `compromised` is admin-only | Built |
| T15 | Elevation: the `system` role obtained over HTTP | HTTP authenticators return human roles only; `x-dev-role: system` rejected (tested) | Built |
| T16 | Elevation: approval reused for a different plan | Approval digest over plan, snapshot and result hashes; recomputed at request, decision and execution; one plan reference per request | Built, tested |
| T16a | Elevation: self-approval or approval by an unauthorized person | `approval:decide` only for `approver`/`admin`; separation of duties by policy; one decision per person | Built, tested (identity still from the development authenticator) |
| T16b | Stale approval executed long after review | Pending expiry and an execution window | Built, tested |
| T17 | Race: two requests create an authority cycle | Per-organization advisory lock (tested) | Built |
| T18 | Race: concurrent status changes | Row lock; exactly one wins (tested) | Built |
| T19 | Unauthenticated runtime events accepted as evidence | Unique event ids, redaction, 0.65 confidence for attempted/denied and human review below 0.8. Producer authentication and signatures | **Partly built.** Ingestion needs `discovery:ingest` (human roles today); event authenticity is planned with the gateway |
| T20 | A false "contained" status | Distinct planned/approved/submitted/executed/verified states; `contained` only from a fully passed verification run; partial and inconclusive are never full containment; checks observe the live gateway and pinned graph, not enforcement's report | Built, tested (probes use simulated executors) |
| T21 | Supply chain: malicious dependency | Lockfile, scanning in CI | **No CI yet** |
| T22 | LLM manipulation influences decisions | LLM never approves, enforces or decides ownership | Policy; no LLM in the code |

## Residual risk to accept or fix

1. Everything depends on real authentication, which does not exist yet (T1).
2. A privileged database user can disable triggers (T4) until hashing and anchoring exist.
3. The graph is only as good as what was registered or discovered; the product states this.
4. Secret detection is a guardrail, not a guarantee (T11).

## Review cadence

Revisit this document when authentication lands, when the gateway is designed (new boundary), and before any public deployment.
