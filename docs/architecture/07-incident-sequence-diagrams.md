# Incident Sequence Diagrams

Legend: solid steps marked **[built]** exist today; steps marked **[planned]** are designs. Participant names match the modules in [03-module-architecture.md](03-module-architecture.md).

## 1. Registration and dependency recording [built]

```mermaid
sequenceDiagram
  actor Owner
  participant API
  participant AR as Agent Registry
  participant DR as Dependency Registry
  participant DB as PostgreSQL
  Owner->>API: POST /agents (name, type, externalReference, capabilities)
  API->>AR: register(principal, input)
  AR->>DB: tx: agent + status history + audit
  Owner->>API: POST /resources
  Owner->>API: POST /dependencies (typed, provenance, confidence)
  API->>DR: create(principal, input)
  DR->>DB: tx: endpoints exist in org? authority cycle? insert dependency + version + audit
  DR-->>Owner: 201 version 1
```

## 2. Automated discovery [planned; registry side built]

```mermaid
sequenceDiagram
  participant Sched as Scheduler (pg-boss)
  participant AD as Source adapter
  participant ND as Normalize + resolve + validate
  participant AR as AgentRegistryReader
  participant RC as Reconciler
  participant W as DependencyRegistryWriter
  Sched->>AD: run(source)
  AD-->>ND: raw records (configs, workflows, gateway events)
  ND->>AR: resolve externalReference within the organization
  ND-->>RC: resolved observations (unresolved ones kept aside)
  RC->>W: createOrUpdate(evidence[])
  W-->>RC: created | updated | unchanged | rejected
  Note over RC,W: A failed source never deactivates a dependency.<br/>Missing observations are recorded, not acted on.
```

## 3. Incident response, end to end [planned]

```mermaid
sequenceDiagram
  actor Op as Operator
  participant IM as Incident Management
  participant GE as Graph Engine
  participant BR as Blast-Radius
  participant CE as Containment
  participant AP as Approval
  participant AG as Gateway
  participant VE as Verification
  participant EV as Evidence
  Op->>IM: open incident (source agent, type, trigger)
  IM->>EV: record "incident opened"
  IM->>GE: build graph (snapshot pinned to the incident)
  IM->>BR: analyze(snapshot, source)
  BR-->>IM: compromised / exposed / potentially affected / healthy / uncertain, with paths
  IM->>CE: plan(snapshot, impact, protected resources, healthy workflows, enforcement points)
  CE-->>IM: actions, preserved workflows, uncertainty, approval requirements
  IM->>AP: request approval (bound to plan hash)
  Op->>AP: approve
  IM->>AG: apply approved actions
  AG-->>IM: per-action result (submitted / executed / failed)
  IM->>VE: verify
  VE->>AG: retry blocked operation
  VE->>AG: run healthy workflow
  VE-->>IM: expected vs observed
  IM->>EV: record every stage
  IM-->>Op: verified | contained-with-gaps | failed
```

## 4. Authorization at the enforcement boundary [planned]

```mermaid
sequenceDiagram
  participant Agent
  participant GW as Gateway
  participant PE as Policy evaluator
  participant EV as Evidence/audit
  Agent->>GW: operation request
  GW->>PE: decide(agent, operation, current permission state)
  alt allowed
    GW->>GW: recheck authorization at execution (in-flight safety)
    GW-->>Agent: result
  else denied or agent suspended/compromised
    GW-->>Agent: rejected
  end
  GW->>EV: record allowed / denied / succeeded / failed
```

A gateway failure or an unreachable policy store denies the operation (fail closed).

## 5. Evidence and anchoring [planned]

```mermaid
sequenceDiagram
  participant IM as Incident Management
  participant EV as Evidence Service
  participant DB as PostgreSQL
  participant AK as Arkiv
  participant CH as Ethereum Sepolia
  IM->>EV: append(stage, payload)
  EV->>EV: canonicalize, hash, link to previous hash, sign
  EV->>DB: append-only record
  EV->>AK: store snapshot (best effort, failure recorded)
  EV->>CH: anchor hash (best effort, status tracked)
  Note over EV: A record is "submitted" until its anchor is confirmed.
```

## 6. Failure paths to handle

| Failure | Required behavior |
|---|---|
| Authenticator unavailable | 401 for everything (fail closed) |
| Chain transaction fails or is dropped | Action stays "submitted/failed", incident is not "contained" |
| Arkiv or ENS unavailable | Reported, retried; core incident flow continues with the gap recorded |
| Partial containment | Incident ends `contained-with-gaps` or `failed`, never `verified` |
| Verification fails | Reported with expected vs observed; actionable next step; incident not marked verified |
| Approval rejected or plan changed | Plan cannot execute as approved |
