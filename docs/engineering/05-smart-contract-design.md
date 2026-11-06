# Smart Contract Design

> **Implemented: `EvidenceAnchor`** (commitments to sealed evidence) in `contracts/`, with 34 Foundry tests and a tested TypeScript client. See [../modules/evidence-service/ethereum-integration.md](../modules/evidence-service/ethereum-integration.md). **Not deployed.** The `AgentPermissionRegistry` described below remains a **proposal**: PostgreSQL stays the source of truth for permissions.

**Status: planned (design).** The `contracts/` directory is empty. This proposal keeps the on-chain surface small, because contracts are costly to change and the registries stay authoritative for application state.

## Goals

1. Hold **revocable authorization state** that the gateway can check and that outside parties can inspect.
2. Emit **events** that serve as verifiable response evidence (who changed what, tied to an incident and plan).
3. Provide transaction references for the evidence record.

Non-goals: store dependency graphs, incident data or secrets on-chain; reverse completed transactions; replace existing wallet security products.

## Network and tooling

Ethereum **Sepolia** testnet only. Solidity with Foundry (tests, fuzzing, deployment scripts). Local development on Anvil.

## Proposed contract: `AgentPermissionRegistry`

State:

| Item | Purpose |
|---|---|
| `owner`, role `RESPONDER` | Who may grant and who may revoke (the CORVEN executor, or the Chainlink CRE forwarder if adopted) |
| `mapping(bytes32 agent => mapping(bytes32 permission => Grant))` | Grant: `granted`, `expiresAt`, `revokedAt` |
| `mapping(bytes32 agent => bool) suspended` | Agent-wide suspension |
| `mapping(address => uint256) nonces` | Replay protection for signed requests |

Identifiers are `bytes32` hashes of the database uuids, so no personal or sensitive text goes on-chain.

Functions (sketch):

```solidity
function grant(bytes32 agent, bytes32 permission, uint64 expiresAt) external onlyOwner;
function revoke(bytes32 agent, bytes32 permission, bytes32 incidentId, bytes32 planHash) external onlyResponder;
function suspend(bytes32 agent, bytes32 incidentId, bytes32 planHash) external onlyResponder;
function reinstate(bytes32 agent) external onlyOwner;
function isAuthorized(bytes32 agent, bytes32 permission) external view returns (bool);
```

Events: `PermissionGranted`, `PermissionRevoked(agent, permission, incidentId, planHash, by)`, `AgentSuspended(agent, incidentId, planHash, by)`, `AgentReinstated`.

## Security requirements

| Requirement | Detail |
|---|---|
| Explicit access control | Separate owner and responder roles; no unauthenticated state change |
| Validated state transitions | Cannot revoke a never-granted permission silently; reinstating requires the owner |
| Replay protection | EIP-712 typed signatures with per-signer nonces and a deadline, if meta-transactions are used |
| Safe signature verification | Use audited libraries (OpenZeppelin ECDSA); reject malleable signatures |
| Expiry | `isAuthorized` returns false after `expiresAt` |
| Revocation checks | Revocation always wins over a later view of the grant |
| Gas and DoS | No unbounded loops; bounded storage per call |
| Upgradeability | None for the MVP (immutable), to avoid an upgrade-key attack surface |

## Tests (Foundry)

Valid grant; unauthorized grant and revoke; expiry boundary; revoke then check; suspend and reinstate; invalid signature; replay attempt; deadline passed; role changes; fuzz on expiry values and identifier collisions; gas snapshot for the revoke path.

## Open decisions

- Is the chain the permission source of truth, or a mirror of PostgreSQL? ([architecture/01-system-architecture.md](../architecture/01-system-architecture.md), decision 2.) The contract should not be built before this is decided.
- Does Chainlink CRE call this contract directly?
- Gas funding and key management for the executor on Sepolia.

## Honest limits

On-chain revocation only affects systems that consult the contract. It does not stop an agent holding an independent API key, and it cannot undo completed transactions.
