# Ethereum anchoring

**Status:** the contract and its tests are implemented and pass locally; the TypeScript client is implemented and tested against a **real local EVM (Anvil)**; **nothing has been deployed to Sepolia and no real transaction has been sent.** The Sepolia endpoint, the signer's derived address and its balance were verified by read-only calls.

## Architecture

```mermaid
flowchart LR
  EV[Evidence Service] -->|submit(hash, ids)| CL[ViemEthereumAnchor]
  CL -->|dry run eth_call, then tx| C[(EvidenceAnchor on Sepolia)]
  C -->|EvidenceAnchored event| CL
  CL -->|status: mined/reverted, confirmations, hash in event| EV
  R[Reviewer] -->|verify(evidenceRef, hash) / logs| C
```

Only a commitment goes on chain. The evidence document, incident text, approvals and payloads never do.

## The contract (`contracts/src/EvidenceAnchor.sol`)

| Item | Detail |
|---|---|
| Storage | `evidenceRef -> Anchor { incidentRef, evidenceHash (SHA-256, stored byte for byte), schemaVersion, sequence, anchoredBy, blockNumber, timestamp }`, plus `hash -> evidenceRef`, the signer set and `anchorCount` |
| References | `evidenceRef = keccak256("corven.evidence.v1:" + evidenceUuid)`, `incidentRef = keccak256("corven.incident.v1:" + incidentUuid)`. A reviewer who holds the uuid recomputes them; the chain reveals nothing else |
| Write | `anchorEvidence(evidenceRef, incidentRef, evidenceHash, schemaVersion, sequence)`, only for authorised signers. Reverts on any zero value, zero version or sequence, a duplicate `evidenceRef` (`EvidenceAlreadyAnchored`) or a hash already anchored under any reference (`HashAlreadyAnchored`). Non-payable |
| Read | `getAnchor`, `isAnchored`, `verify(evidenceRef, hash)`, `evidenceRefOfHash`, `isSigner`, `anchorCount` |
| Event | `EvidenceAnchored(evidenceRef indexed, incidentRef indexed, evidenceHash indexed, schemaVersion, sequence, anchoredBy)` |
| Admin | OpenZeppelin `Ownable2Step`: the owner adds or removes signers (`setSigner`, event `SignerUpdated`). Ownership transfer is two-step; **renouncing is disabled**. The owner is **not** automatically a signer |
| Immutability | Not upgradeable. An anchor can never be changed, replaced or removed, by anyone, including the owner. Removing a signer stops new anchors only |
| Hash algorithm | The contract does not hash. It stores the SHA-256 produced by the Evidence Service and never reinterprets it |

## The client (`ViemEthereumAnchor`)

- Refuses Ethereum mainnet (chain id 1) at construction, and refuses an endpoint whose chain id differs from the configured one, or a contract address with no code.
- `submit(hash, ref)`: reads the contract first; if the evidence is **already anchored** with the same hash it returns the original transaction and sends nothing (idempotent after a crash or retry); with a different hash it refuses. Otherwise it **dry-runs** the call (`eth_call`): a call that would revert (unauthorised signer, duplicate hash) fails there and spends nothing. Only then does it send. It returns a transaction hash, which is a submission and nothing more.
- `status(txHash)`: `not_found`, `pending` (no receipt), `mined` or `reverted`; confirmations = head - block + 1 (the block-number cache is disabled so counts are never stale); and whether the hash is present in an `EvidenceAnchored` event **emitted by the configured contract in a successful transaction to it**. A plain transfer carrying the hash, a call to another contract, or a reverted call that contains the hash in its calldata does not count (all tested).
- `verifyOnChain(evidenceId, hash)` and `signerIsAuthorized()` are reads of the contract.
- Errors are reduced to a short scrubbed message: no RPC URL (which can embed an API key), no key, no request bodies.
- The private key is held only by the viem account object, is never serialized, logged or read from the environment by this class (a test dumps the object in full and searches for the key).

## The confirmation rule (unchanged, enforced by the Evidence Service)

An Ethereum anchor is **confirmed** only when the transaction is mined, **succeeded**, the expected hash is present in the contract's event, and it has at least **3 confirmations**. Reverted, wrong-destination or wrong-hash transactions become `failed`. Not enough confirmations leaves the anchor `submitted` and the evidence `anchor_pending`. RPC errors never invalidate the evidence record. Tested against the real local chain: 1 confirmation and 2 confirmations stay `submitted`; the third makes it `anchored`; the evidence then verifies and the contract's `verify` agrees.

Refresh is manual (`POST /evidence/:id/anchors/refresh`) or by the orchestrator's maintenance (`Orchestrator.maintenance`, run by the pg-boss ticker).

## Environment variables

| Variable | Meaning |
|---|---|
| `ETHEREUM_SEPOLIA_RPC_URL` | Sepolia JSON-RPC endpoint. **Secret** (embeds an API key). Must serve chain 11155111 |
| `ETHEREUM_CHAIN_ID` | `11155111` |
| `ETHEREUM_SIGNER_PRIVATE_KEY` | Key of the **anchor signer**: a dedicated development wallet that holds only test ETH and is never used on mainnet. **Secret.** Not read by any code today |
| `EVIDENCE_ANCHOR_CONTRACT_ADDRESS` | Deployed contract. **Empty until an approved deployment** |

The variables live in the repository's root `.env` (git-ignored). `apps/api/.env` is also read if it exists and overrides the root file. **The server does not yet construct the client from these variables**; wiring `ViemEthereumAnchor` into `evidenceConfig` at startup is a separate, small step to take after deployment.

`pnpm --filter @corven/api eth:verify [--expect 0xAddress]` performs a read-only check: chain id must be 11155111 (and stops with a clear message on mainnet), block number, balance and nonce of the signer or expected address, signer-vs-expected comparison, and contract code if an address is configured. It sends nothing and prints neither the URL nor the key.

## Local testing

```bash
cd contracts && forge build && forge test          # 34 contract tests
cd apps/api && pnpm vitest run test/ethereum-anchor.test.ts   # needs anvil and the built artifact; 19 tests against a local EVM
```

## Deployment procedure (not performed; requires explicit approval)

1. Choose the owner (a dedicated admin key or a multisig, **not** the day-to-day signer) and the signer address.
2. Dry run, which simulates and sends nothing: `EVIDENCE_ANCHOR_OWNER=0x… EVIDENCE_ANCHOR_SIGNER=0x… forge script script/DeployEvidenceAnchor.s.sol --rpc-url "$ETHEREUM_SEPOLIA_RPC_URL"` from `contracts/`. The script itself refuses any chain except Sepolia and local Anvil.
3. Review the simulated address, gas and constructor arguments.
4. Broadcast with `--broadcast` and a keystore account or hardware wallet (`--account`/`--ledger`), not a key on the command line.
5. Verify the source on Etherscan (`forge verify-contract`), put the address in `EVIDENCE_ANCHOR_CONTRACT_ADDRESS`, run `pnpm eth:verify`.
6. Wire the client into the server's `evidenceConfig`, then send one real anchor and watch it reach three confirmations.

## Security assumptions and limits

- A matching hash proves the document has not changed since it was anchored. It does not prove the events were genuine.
- Whoever holds an authorised signer key can anchor any hash; the contract cannot judge the content. Signer keys must be guarded and removed on suspicion (`setSigner(addr, false)`), which does not affect earlier anchors.
- The owner can add signers and therefore control what may be anchored, but cannot alter or remove anchors. Use a separate, well-protected owner.
- Anchoring proves existence at a time, not that the Evidence Service's source tables were truthful.
- A transaction in the mempool when a retry happens can be duplicated; the contract rejects the second (`HashAlreadyAnchored`), costing gas only.
- Sepolia is a testnet: it can be reorganised and has no economic finality. Three confirmations is a policy value.
- The contract has not been independently audited.
- ENS, Arkiv and Chainlink CRE are not part of this work.
