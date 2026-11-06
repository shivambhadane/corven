# CORVEN contracts

Solidity 0.8.28 with Foundry. One contract so far: **`EvidenceAnchor`**. Nothing is deployed. `EVIDENCE_ANCHOR_CONTRACT_ADDRESS` stays empty until a deployment is explicitly approved.

## Layout

| Path | Contents |
|---|---|
| `src/EvidenceAnchor.sol` | The contract |
| `test/EvidenceAnchor.t.sol` | 33 tests, including 3 fuzz tests (512 runs each) |
| `test/DeployEvidenceAnchor.t.sol` | The deploy script: works locally, refuses mainnet and every other chain |
| `script/DeployEvidenceAnchor.s.sol` | Deployment script (reads owner and signer addresses, never a private key) |
| `lib/` | `openzeppelin-contracts` v5.7.0 and `forge-std` v1.17.0, pinned, installed with `forge install --no-git` |
| `foundry.toml` | solc 0.8.28, cancun, optimizer 200 runs |

`lib/` is currently an untracked directory (no submodule was created). Before committing, choose one: `git submodule add` both repositories at those tags, or commit the files (about 18 MB). Do not leave it ambiguous.

## Commands

```bash
cd contracts
forge build
forge test                       # 34 tests
forge coverage --report summary  # EvidenceAnchor.sol: 100% lines, statements, branches, functions
forge fmt --check
```

The TypeScript suite (`apps/api/test/ethereum-anchor.test.ts`) deploys the compiled artifact to a local **Anvil** chain and exercises the real client against it, so run `forge build` first. It is skipped, by name, if `anvil` or the artifact is missing.

## Deploying to Sepolia (not done; needs explicit approval)

See `docs/modules/evidence-service/ethereum-integration.md`. In short: dry run with `forge script` (no `--broadcast`), review, then broadcast with a keystore or hardware signer, record the address, and verify the code on Etherscan.
