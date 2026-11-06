# Evidence testing

| File | Focus |
|---|---|
| `test/evidence-core.test.ts` (20) | Sealed-versus-current comparison (identical, legitimate later activity, every kind of alteration and removal), chain and Arkiv doubles, and the JSON-RPC client against a fake transport (mined, pending, reverted, unknown, RPC error, no signer) |
| `test/evidence-api.test.ts` (29) | Full compromised-agent scenario driven through every module to `contained`, then: sealed content; free text, secrets and credentials excluded; determinism; hash chain; concurrent generation; timeline event; roles and tenancy; verification of untouched records; tampered content, hash and chain; source tampering in six different tables and in a verification result; legitimate later activity accepted; anchoring (hash only, Arkiv read-back, Ethereum submitted vs confirmed, confirmation depth, outage, retry, reverted and mismatching transactions, external mismatch, invalid evidence refused, no double publish); immutability |
| `test/migrations.test.ts` | 0018 and 0019 |

Full suite at the time of writing: 735 tests in 45 files; `tsc` and ESLint clean.

**All external behaviour was tested against in-memory doubles and a fake JSON-RPC transport. Nothing was tested against Arkiv, a real Ethereum node or a testnet.**
