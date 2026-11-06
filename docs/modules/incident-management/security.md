# Incident Management: security

## Trust boundaries

| Input | Source of truth |
|---|---|
| Organization | the authenticated principal, never a body, query or URL |
| Actor | the principal's `actorId`; `createdBy`, `authorId`, `assignedBy` cannot be supplied |
| Detection source | forced to `manual` over HTTP; automated sources only through `system` |
| Association `source` | forced to `manual` over HTTP |
| Trusted-module transitions and events | the `system` principal, unobtainable over HTTP |

## Tenant isolation and IDOR

Every repository method filters on `organization_id`. A foreign incident, agent, resource, snapshot or reference is `404`, indistinguishable from a missing one. The database adds a second layer: composite foreign keys make a cross-tenant association impossible even for code that forgot the filter (tested with a raw insert). Explicit blast-radius or plan source nodes from another tenant do not exist in the pinned snapshot, so they also return 404.

## Integrity

- Append-only history tables with triggers (SQLSTATE 23001).
- Row lock plus state re-check on every change; concurrent transitions: exactly one wins.
- Pinned snapshots are re-hashed before use. Tampering is reported by `verify` and blocks new analysis (`SNAPSHOT_INTEGRITY_FAILED`).
- References carry result hashes, so a stored analysis can be shown to be reproducible or not.

## Credential hygiene

Titles, descriptions, notes, reasons, assignment notes, source references and external event data are scanned for private keys, AWS keys, bearer tokens, JWTs, 32-byte hex values, API keys and inline `password=` style values, and for secret-looking key names in structured data. Key names are matched as password, passphrase, secret, token, private key, API key, mnemonic, seed phrase, credential, authorization or bearer (a bare "pass", as in `passed`, is not). Matches are rejected with `CONTAINS_SECRET`, naming the kind of thing found but never echoing it. This is a guardrail, not a scanner: it cannot find every secret. The timeline records note existence and length, not note text.

## Threats considered

| Threat | Mitigation |
|---|---|
| A person marks an incident contained | `contained` and the states leading to it are system-only edges |
| Failed or partial enforcement reported as success | Separate states; `containment_failed` and `partially_contained` cannot reach `contained` |
| Approval of a stale or different plan | Plans must be generated after entering the state, on the current snapshot, and are locked once approval is requested; the plan hash is recorded on `approval.requested` |
| Rewriting history | Append-only tables; no update or delete routes |
| Duplicate or replayed internal events | Idempotency keys on events and transitions; signal deduplication |
| Log or header injection through correlation ids | Strict alphabet, otherwise replaced |
| Reopening hides evidence | Reopen is an admin-only audited transition; history is retained |

## Known limitations

- **No human identity or membership model.** `assigneeId` is checked only as a UUID; it is not verified to be a member of the organization. Authentication is the development header adapter and must be replaced before any real deployment.
- Incident roles are the existing coarse roles. The finer roles in the brief (Incident Approver, Security Engineer) arrive with the Approval Service.
- The secret guard is best effort.
- Result data for analysis references is regenerated, not stored; if an engine's algorithm changes in a way that alters output for the same input, `verify` will report `reproducible: false`. `ENGINE_VERSION` is recorded to make that visible, but there is no mechanism to run an old engine version.
- Snapshots have no explicit format version field; the module records the version it assumes (`1`).
- No SLA timers, reminders or automatic closure.
- No bulk operations or incident merge.
