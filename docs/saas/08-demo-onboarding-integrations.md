# Public demo, onboarding and integration status

## Two ways in, one engine

| | Explore CORVEN (`/demo`) | Deploy CORVEN (`/signup` → `/app`) |
|---|---|---|
| Account | None | Firebase sign-in, verified email |
| Organization | A fresh sandbox organization per visit | Your own, or one you were invited to |
| Data | The Acme Technologies network (5 agents, 3 resources, 7 dependencies), seeded through the normal API | What you register |
| Engines | The real blast-radius, containment, approval, gateway, verification and evidence code | Same |
| Execution | Gateway against **simulated executors** (nothing outside CORVEN is touched) | Gateway against the executors configured on the server |
| Evidence anchoring | As configured on the server (Arkiv Rabdi when configured; real entity, read back) | Same |

The only difference is where the data comes from and which executors run. There is no second implementation of the security rules.

### How the demo sandbox works

- `POST /api/v1/demo/sessions` (public) creates a random organization id, seeds the Acme network through the same validated routes customers use, puts every sandbox resource behind the gateway with a `SimulatedExecutor`, and returns a signed token valid for 2 hours.
- Requests carry `x-corven-demo: <token>` and `x-corven-demo-persona: admin | operator | approver`. Personas are distinct actors, so separation of duties still applies: the operator who raises the incident cannot approve the plan.
- A demo token reaches only its own sandbox. It is refused (403) on every `/api/v1/saas/*` route: no API keys, webhooks, members or organization settings.
- Tokens are signed with a key generated at server start, so sessions end on restart (as do the in-memory simulated executors).
- Rate limits: 12 sessions per client IP per hour, 300 per hour overall. `buildApp({ demo: false })` turns the demo off.
- "Reset" starts a new session: a new, empty sandbox. Old sandbox rows stay in the database (audit tables are append-only) but are unreachable once the token expires.

The `/demo` page walks through Discover → Incident → Blast radius → Containment → Execute → Verify → Evidence. Blast-radius and plan details are re-computed with the read-only engines on the incident's pinned snapshot; the page shows that the recomputed plan hash matches the one the workflow stored.

## Onboarding a person

1. Sign up (Google or email/password). Email/password accounts must verify their address.
2. If invitations exist for that verified email, the onboarding page shows them first (organization, role, date) with Accept / Decline. Accepting is explicit; nothing is granted before.
3. Otherwise: "Let's set up your workspace." Name, optional website and title. The creator becomes admin on the starter plan.
4. `/app` shows the organization, "Logged in as", the role from the database, and an organization switcher when the person belongs to several. Every API request carries `x-corven-org-id`, honoured only for an active membership.

## Setting up an organization (`/app` → Setup)

Integration method (REST API, enforcement gateway, manual; SDK marked not implemented) → register agents → register resources (optionally behind the gateway) → relationships (authority needs a dotted scope; resource access can add a gateway permission) → discovery (creates a gateway-activity source and runs it) → review the graph → a read-only what-if blast-radius analysis. Nothing in setup enforces containment.

## Integration status (`GET /api/v1/integrations`, console → Integrations)

| | Purpose | State in this build |
|---|---|---|
| Arkiv | Stores sealed evidence as an entity and reads it back | Working on Rabdi when `ARKIV_*` is configured |
| Ethereum | Anchors the evidence hash in the EvidenceAnchor contract; counted after the required confirmations | Not configured until the contract is deployed (`EVIDENCE_ANCHOR_CONTRACT_ADDRESS`) |
| ENS | Forward resolution of names for identities (`POST /api/v1/integrations/ens/resolve`, 30/min per organization) | Configured when a Sepolia RPC URL is set; never grants or revokes anything |
| Chainlink CRE | External workflow coordination | **Not implemented**; reported as such, nothing simulated |

The status endpoint never returns keys, RPC URLs or signer details.
