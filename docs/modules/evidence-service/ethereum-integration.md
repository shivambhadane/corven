# Ethereum and ENS

## Interface

`EthereumAnchorClient`: `submit(contentHash) -> txHash` and `status(txHash) -> { state, blockNumber, confirmations, dataContainsHash }`.

## Rules (enforced by the service for any client)

- A submitted transaction is recorded as **`submitted`**, never as anchored.
- It becomes **`confirmed`** only when it is mined, **successful**, its data **contains the evidence hash**, and it has at least `requiredConfirmations` (default 3) confirmations (the including block counts as 1).
- A reverted transaction, or a mined one that does not carry the hash, is `failed`. Not enough confirmations leaves it `submitted` and the evidence `anchor_pending`.
- Chain id, contract address (if any), block number and confirmation count are stored. Only the hash goes on chain, never evidence content.
- RPC errors never invalidate the evidence; the anchor stays as it was and the step is reported `unavailable`.

## What exists

- **`JsonRpcEthereumAnchor` (real code):** standard JSON-RPC `eth_getTransactionReceipt`, `eth_getTransactionByHash`, `eth_blockNumber`. Tested against a fake transport only; **it has never talked to a node.**
- **Submitting transactions: not built.** It requires a signing key and nonce/gas management. `JsonRpcEthereumAnchor` accepts an optional `signer(contentHash) -> txHash`; without one, `submit` throws and the anchor is `failed`. No private key is read, stored or logged by CORVEN. Key custody is an open decision (see the environment-configuration planned variables).
- The Solidity contract and event design in `docs/engineering/05-smart-contract-design.md` are **not implemented**; today an anchor is a transaction whose data carries the hash.

## ENS

Agent identities (including ENS names and their recorded verification state) are copied into the evidence as registered. **No live ENS resolution happens**, so the record shows what CORVEN held, not what ENS resolves to now, and ENS ownership is never treated as authority or as permission revocation.
