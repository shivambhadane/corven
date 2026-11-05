# Problem Statement

## Background

Autonomous AI agents are being wired into business systems and decentralized applications. They interact with blockchain wallets and contracts, external APIs, databases, other agents, MCP servers and tools, cloud services, delegated credentials and business workflows. Together these form interconnected systems where one agent may depend on, or hold authority over, many other components.

## The problem

When an agent is compromised, disabling its process or identity is usually not sufficient, because it may have:

- delegated permissions to other agents;
- access to credentials that other agents also use;
- access to resources that healthy agents depend on;
- operations already in flight;
- dependencies that are not visible from its own identity;
- access to external systems the response system does not control.

Existing controls tend to look at a single identity, permission, transaction or runtime event. The operational impact of an incident, and how to contain it without needless downtime, is left to manual judgment under time pressure.

## Why the obvious responses fail

| Response | What goes wrong |
|---|---|
| Disable the agent | Authority it delegated and resources it reached remain usable; downstream workflows keep running |
| Revoke everything it touched | A shared resource revoked for everyone also stops every healthy agent that uses it |
| Do nothing until the picture is clear | The attacker keeps the access it already has |

## Key challenges

| Challenge | Description |
|---|---|
| Fragmented visibility | Dependencies are spread across configurations, workflows and runtime systems |
| Delegated authority | Permissions are passed between agents |
| Hidden blast radius | One agent may affect several downstream components |
| Shared resources | Blind revocation disrupts healthy agents |
| Incomplete enforcement | Independent systems hold credentials outside the response system's control |
| Limited verification | It is often unknown whether containment worked |
| Evidence integrity | Incident records need to be verifiable and tamper-evident |

## The gap

Cross-system incident response that understands dependencies and minimizes operational disruption. Concretely, someone has to be able to answer, quickly and with evidence:

1. What can this compromised agent actually reach, through which relationships?
2. What is the smallest set of changes that blocks that reach?
3. Which healthy workflows would those changes break, if any?
4. Did the containment work, and what is the proof?

## Proposed solution

CORVEN combines a typed dependency graph, deterministic containment planning, controlled authorization enforcement, post-containment verification and verifiable incident records. The primary innovation target is **cross-system dependency-aware incident response with minimum safe containment and verification**, demonstrated through real system behavior rather than described only in concept.

## What is already built toward it

The foundation that answers question 1 exists: registries of agents, resources and typed, versioned dependencies, plus an immutable graph with reachability and path queries. Questions 2 to 4 (blast radius, containment, verification, evidence) are designed in `docs/modules/` and are not implemented. See [00-project-overview.md](00-project-overview.md).

## Honest scope

CORVEN is an incident-response layer, not a universal security guarantee. It can only enforce controls over systems routed through its own enforcement points; it cannot reverse completed blockchain transactions or revoke independent credentials; and the absence of a discovered dependency is not proof that none exists. See [project/06-known-limitations.md](project/06-known-limitations.md).
