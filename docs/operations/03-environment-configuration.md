# Environment Configuration

Configuration comes from environment variables. Secrets never go in Git, `CLAUDE.md`, `.env.example` or chat. The root `.gitignore` excludes `.env` and `.env.*` (except `.env.example`).

## Variables in use today

| Variable | Used by | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | API, migrations | none (required) | PostgreSQL connection string |
| `PORT` | API | `3001` | Listen port (binds to `127.0.0.1`) |
| `NODE_ENV` | API | unset | `production` makes the server refuse the dev authenticator |
| `CORVEN_DEV_AUTH` | API | unset | `1` enables the development header authenticator. **Never in production.** Without it every `/api` request is 401 |
| `DISCOVERY_QUEUE` | API | unset (pg-boss) | `inline` runs discovery jobs in-process (local use, tests). Otherwise jobs go through pg-boss on `DATABASE_URL`, which creates its own `pgboss` schema |
| `AGENT_TOKEN_SECRET` | API | unset | Signing key for agent tokens: hex or base64 of at least 32 random bytes. **Secret.** Unset disables agent authentication (503), except under `CORVEN_DEV_AUTH=1`, which uses an ephemeral key |
| `ORCHESTRATOR_TICKER` | API | on | `off` disables the pg-boss schedule that drives incident-response workflows (they can still be run by `POST /workflows/:id/run`) |
| `ETHEREUM_SEPOLIA_RPC_URL`, `ETHEREUM_CHAIN_ID` | `eth:verify` script, future server wiring | none | Sepolia endpoint (**secret**: embeds an API key) and `11155111`. Verified read-only; the server does not use them yet |
| `ETHEREUM_SIGNER_PRIVATE_KEY` | future server wiring | none | Dedicated anchor-signer key (**secret**, testnet only, never mainnet). Not read by any code today |
| `EVIDENCE_ANCHOR_CONTRACT_ADDRESS` | future server wiring, `eth:verify` | empty | Set only after an approved deployment |
| `TEST_ADMIN_DATABASE_URL` | Tests | `postgres://corven:corven_local_only@127.0.0.1:54329/postgres` | Admin connection used to create and drop the throwaway test database |

Local credentials in `docker-compose.yml` (`corven` / `corven_local_only`) are throwaways bound to `127.0.0.1`. They are not secrets and must never be reused anywhere.

## Planned variables

| Variable | Purpose | Secret? |
|---|---|---|
| `SEPOLIA_RPC_URL`, `CHAIN_ID` | Chain access | URL may embed a key: treat as secret |
| `CONTRACT_PERMISSION_REGISTRY` | Deployed contract address | No |
| `EXECUTOR_PRIVATE_KEY` or a KMS key id | Signs enforcement transactions | **Yes** |
| `EVIDENCE_SIGNING_KEY_ID` (and key material in a secret store) | Signs evidence records | **Yes** |
| `ARKIV_ENDPOINT`, `ARKIV_API_KEY` | Arkiv access | Key is secret |
| `ENS_RPC_URL` | ENS resolution | Treat as secret |
| `CRE_VERIFICATION_KEY` | Verify workflow results | Yes |
| Auth settings (issuer, audience, JWKS URL, session secret) | Real authentication | Secrets where noted |
| `GRAPH_*`, further `DISCOVERY_*` tuning | Limits, schedules | No |
| `LOG_LEVEL` | Logging | No |

## Rules

1. Validate configuration at startup and fail fast with a clear message (the server already does this for `DATABASE_URL` and the dev-auth guard).
2. One variable, one meaning; no secrets in logs or error messages.
3. Separate values per environment (local, demo); no production secrets on developer machines.
4. Rotate any credential that appears in a transcript, log or commit.
5. Document every new variable here in the same change that introduces it.
