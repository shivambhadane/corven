# Infrastructure Plan

**Status: planned.** Only local development infrastructure exists. Nothing has been provisioned in any cloud account.

## Goals

A reproducible local setup without paid services, a publicly reachable testnet demo, and deliberately small infrastructure that fits free tiers and about $100 in AWS credits (subject to eligibility and expiry).

## Components

| Component | Choice | Why |
|---|---|---|
| Frontend (dashboard, landing) | Vercel | No servers; static and Next.js hosting |
| API and worker | One small AWS EC2 instance in Docker | Hosts the modular monolith and the optional worker without extra services |
| Database | Neon PostgreSQL (free tier first) | Managed PostgreSQL with minimal ops |
| Source control and CI/CD | GitHub, GitHub Actions | Already in use |
| DNS and TLS | Cloudflare if required | HTTPS for the API |
| Chain | Ethereum Sepolia | Testnet only |
| Records | Arkiv | Evidence persistence |

Not used on purpose: Kubernetes, managed queues, load balancers, NAT gateways and other services that add cost and complexity without helping the demo.

## Cost controls

- Smallest viable instance size; stop it when not demoing.
- Budget alerts set on day one; check actual usage regularly.
- Avoid managed services and expensive networking; no NAT gateway.
- Verify which services the credits cover before using them.
- Shut down unused resources after the event.

## Security baseline

Secrets only in the platform's secret store (never in Git); least-privilege IAM; security group allowing only HTTPS (and SSH restricted to the developer's address or disabled); database not publicly open where the provider allows; automatic OS updates; logs without secrets. **No public deployment until real authentication exists.**

## Capacity

No performance targets are promised before measurement. The Graph Engine was measured at 1,000 nodes and 5,000 edges (about 116 ms end to end locally); that is the only measured figure.

## CI/CD plan

On every pull request: install, lint, type-check, unit and integration tests (PostgreSQL service container), contract tests, build. On merge to `main`: deploy approved changes to the demo environment. Missing today: no workflows exist yet.

## Backups and recovery

Neon point-in-time restore on the managed plan; for the demo, the data is reproducible from seed scripts. Migrations run as an explicit deploy step; the down scripts are destructive and for development only.

## Open items

Account setup, budget alert thresholds, domain name, which Neon plan, who holds production secrets, a seed/demo data script.
