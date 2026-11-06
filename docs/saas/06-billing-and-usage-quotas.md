# Subscription Tiers & Usage Quotas

## 1. Subscription Tiers Overview

CORVEN meters usage across 4 dimensions:
1. Number of active registered agents.
2. Number of dependency edges mapped in the live graph.
3. Monthly incident response runs & verification checks.
4. Retention window for sealed evidence packages.

---

## 2. Tier Feature Matrix

| Capability | Starter Tier | Pro Tier | Enterprise Tier |
|---|---|---|---|
| **Monthly Pricing** | Free / Developer | $499 / mo | Custom Contract |
| **Active Agents** | Up to 10 | Up to 100 | Unlimited |
| **Graph Edges** | Up to 100 | Up to 2,500 | Up to 250,000 |
| **Detection Sources** | Config + Runtime Event | Continuous Crawling | Custom MCP Gateway |
| **Approval Quorums** | 1 approver | Up to 3 approvers | Up to 5 approvers + Separation of Duties |
| **Evidence Anchoring** | Arkiv Rabdi | Arkiv Rabdi + Sepolia | Custom Smart Contract & Private Rollup |
| **Outbound Webhooks** | 2 endpoints | 10 endpoints | Unlimited + SIEM Stream |
| **SAML / Enterprise SSO** | No | Optional Add-on | Included |
| **Support SLA** | Community / Best-effort | 99.9% / 8-hour response | 99.99% / 15-minute 24/7 pager response |

---

## 3. Quota Enforcement Logic

Quota checks are applied synchronously at ingestion and registration boundaries:
- `agent:write`: If `current_agents + 1 > tier_limit`, the API rejects the request with HTTP `402 Payment Required` or `403 Forbidden` (`QUOTA_EXCEEDED: agent limit reached for tier`).
- `graph:export` and `analysis:read`: If graph edges exceed the tier threshold, the graph engine reports a bounded subset with warning metadata.
- Automated upgrade notices are emitted via webhooks when a tenant reaches 80% and 100% of their tier quota.
