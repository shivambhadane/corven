# Multi-Tenancy & Enterprise Role-Based Access Control (RBAC)

## 1. Multi-Tenant Data Model

Every tenant in CORVEN is represented by an **Organization**. 

All entity tables (`agents`, `dependencies`, `resources`, `incidents`, `approvals`, `enforcement_actions`, `evidence_records`, `api_keys`, `webhooks`) enforce tenant isolation using composite uniqueness and relational constraints:

- Every record contains an immutable `organization_id: uuid`.
- Primary composite unique indexes: `UNIQUE(id, organization_id)`.
- Foreign key dependencies enforce cross-table tenant match:
  ```sql
  FOREIGN KEY (source_agent_id, organization_id)
    REFERENCES agents (id, organization_id)
    ON DELETE RESTRICT
  ```
  This guarantees that an entity belonging to Organization A cannot reference or interact with an entity in Organization B, even if an application-layer bug were present.

---

## 2. Organization Lifecycle & Subscription Tiers

Organizations are categorized by plan tiers that enforce operational quotas:

| Tier | Default Agent Quota | Max Graph Edges | Evidence Retention | Dedicated Anchoring |
|---|---|---|---|---|
| **Starter** | 10 agents | 100 edges | 30 days | Arkiv Rabdi Shared |
| **Pro** | 100 agents | 2,500 edges | 1 year | Arkiv Rabdi + Ethereum Sepolia |
| **Enterprise** | Unlimited | 250,000 edges | 7 years / Indefinite | Custom Smart Contract & Dedicated VPC |

---

## 3. Enterprise Roles & Responsibilities

CORVEN divides operational duties to uphold **Separation of Duties**:

| Role | Permissions & Capabilities | Typical Persona |
|---|---|---|
| **`admin`** | Full organization control, team invitations, API key management, webhook setup, billing, and incident override. | Head of Security / DevSecOps Lead |
| **`operator`** | Ingest dependencies, trigger manual discovery, declare incidents, analyze blast radius, initiate containment plans. | Security Operations Center (SOC) Analyst |
| **`approver`** | Dedicated authorization authority. Can review containment cut-sets and approve/reject execution. Cannot declare or tamper with incident analysis. | CISO / VP of Engineering / On-Call Incident Commander |
| **`viewer`** | Read-only access to dependency topologies, incident status, audit timelines, and evidence verification receipts. | Compliance Officer / External Auditor |
| **`system`** | Internal process principal for automated pipelines (pg-boss jobs, discovery workers). Explicitly forbidden from approving containment plans (`approval:decide` is withheld). | Background Worker Engine |

---

## 4. Separation of Duties Invariant

Under enterprise policy:
$$\text{Requester} \neq \text{Approver}$$
When `separationOfDuties` is active, the principal that requested the containment plan cannot approve it. Furthermore, automated processes can **never** self-approve a containment plan; containment execution requires human cryptographic authorization.
