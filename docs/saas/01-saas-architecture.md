# CORVEN — SaaS Platform Architecture

## 1. System Overview

CORVEN is an autonomous, dependency-aware incident response platform for interconnected AI agent networks, delivered as a multi-tenant B2B Security SaaS.

As enterprises deploy autonomous agents with access to databases, cloud resources, wallets, and third-party APIs, CORVEN acts as the cross-system security plane that monitors runtime interactions, models the dynamic blast radius of compromised agents, plans least-disruptive containment boundaries, mandates human authorization, actively verifies containment, and produces cryptographically verifiable audit records.

---

## 2. Cloud Topology & Physical Architecture

The SaaS deployment leverages an isolated VPC topology across multiple availability zones:

```
[ Internet / Autonomous Agent Traffic ]
                   │
                   ▼
       [ Cloudflare Edge / WAF ]
          ├── DDoS Protection & Bot Management
          ├── Rate Limiting (Token Bucket per Tenant Tier)
          └── SSL/TLS Termination (mTLS capable for Agent Gateways)
                   │
                   ▼
    [ Application Load Balancer (ALB) ]
                   │
    ┌──────────────┴──────────────┐
    ▼                             ▼
[ Fastify API Service ]      [ Fastify API Service ]
  ├── M2M API Key Auth         ├── M2M API Key Auth
  ├── Session/SSO Auth         ├── Session/SSO Auth
  └── Tenant Context Bound     └── Tenant Context Bound
    │                             │
    └──────────────┬──────────────┘
                   │
                   ├─────────────────────────────────┐
                   ▼                                 ▼
[ AWS Aurora PostgreSQL 17 (Multi-AZ) ]     [ Redis Cluster ]
  ├── Strict Multi-Tenant Schema              ├── Distributed Rate Limits
  ├── Composite Tenant Constraints            ├── Token Blacklists
  └── Immutable Append-Only Logs              └── Gateway Session Cache
                   ▲
                   │
[ pg-boss Background Worker Fleet ]
  ├── Incident Orchestration Pump
  ├── Discovery Worker Jobs
  ├── Webhook Outbound Delivery Dispatcher
  ├── Arkiv DB-Chain Anchoring Service
  └── Ethereum Sepolia Anchor Submitter
```

---

## 3. Core SaaS Principles

1. **Deterministic Isolation**: Every tenant query, graph construction, snapshot, and incident workflow is strictly partitioned by `organization_id`. Database foreign keys enforce composite tenant references at the relational level.
2. **Fail-Closed Security**: In the absence of valid authentication or when an agent token fails database verification, requests are denied immediately with standardized error payloads.
3. **Dual-Plane Authentication**:
   - **Machine-to-Machine (M2M)**: High-entropy, prefix-scanned customer API keys (`crv_live_...`) with fine-grained capability scopes.
   - **Human Console**: Enterprise SAML/OIDC SSO, session cookies, and mandatory hardware MFA (FIDO2) for incident containment approvers.
4. **Verifiable Audit Integrity**: Tamper-evident SHA-256 Merkle hash chaining, independent verifiability endpoints, decentralized storage on Arkiv Rabdi, and smart contract anchoring on Ethereum Sepolia.
