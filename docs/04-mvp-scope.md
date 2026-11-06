# MVP Scope

The MVP is the smallest product that demonstrates the central claim: **identify what a compromised agent can reach, contain it with the smallest safe set of changes, prove healthy workflows survived, and keep verifiable evidence.**

## In scope

| Capability | State |
|---|---|
| Agent registration, lifecycle, capabilities, identity references | Built |
| Resource and dependency registration (authority, resource, operational) | Built |
| Dependency graph construction, traversal, paths, cycles | Built |
| Dependency discovery from configurations, workflows, gateway events | Partial (groundwork) |
| Incident lifecycle | Planned |
| Blast-radius analysis | Planned |
| Minimum-safe-containment calculation | Planned |
| Controlled authorization enforcement, including recheck of in-flight operations | Planned |
| Human approval for sensitive actions | Planned |
| Post-containment verification | Planned |
| Hash-linked, verifiable evidence | Planned (append-only history exists today) |
| ENS and Arkiv integrations | Planned |
| Chainlink CRE integration | Planned, only if it has a meaningful role |
| Web dashboard | Planned |
| Testnet contracts and cloud deployment | Planned |

## Out of scope for the MVP

- Universal support for every agent framework.
- Automatic control over arbitrary third-party credentials.
- Multi-chain execution.
- Reversing completed blockchain transactions.
- Replacing existing wallet security platforms.
- A new universal agent identity protocol.
- A general-purpose AI security scanner or guaranteed detection of every malicious action.
- Autonomous high-impact revocation without appropriate authorization.
- Kubernetes-based infrastructure.
- Machine-learning threat detection.
- Using an LLM to decide whether a relationship is authorized or safe, or to approve or enforce anything.

## Cutting order if time runs short

The PRD says graph analysis, containment and verification are the priority. If the schedule slips, cut in this order and keep everything above it:

1. Chainlink CRE integration.
2. Depth of the ENS integration.
3. Dashboard polish (keep the graph, incident and approval screens).
4. Automatic discovery beyond one adapter (a manual registry still works).
5. Evidence anchoring on-chain (keep hash-linked records in PostgreSQL).

Never cut: containment correctness, verification honesty (a partial response is never reported as contained), tenant isolation, and the limitations section.

## Definition of done (from the PRD)

| Item | State |
|---|---|
| Agents can be registered | Done |
| Dependencies can be represented and retrieved | Done |
| A typed dependency graph can be constructed | Done |
| A compromised agent's blast radius can be calculated | Not done |
| A deterministic containment plan can be generated | Not done |
| Shared resources and healthy workflows are considered in planning | Not done (shared resources are modelled; planning is not) |
| Authorization changes can be enforced at controlled boundaries | Not done |
| Human approval works for sensitive actions | Not done |
| Compromised operations can be blocked; healthy workflows continue | Not done |
| Response results can be verified | Not done |
| Verifiable evidence can be generated and retrieved | Not done |
| Meaningful ENS and Arkiv integrations demonstrated | Not done |
| Chainlink CRE integrated if feasible | Not done |
| The frontend demonstrates the complete workflow | Not done |
| Automated tests pass | Done for built modules (367 tests) |
| Deployed and accessible | Not done |
| Technical limitations documented | Done and maintained |
| Git history and AI attribution maintained | Done; see [project/05-ai-usage-attribution.md](project/05-ai-usage-attribution.md) |
