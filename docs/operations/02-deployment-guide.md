# Deployment Guide

This guide covers what works today (local) and what is planned (cloud). **Do not expose the API publicly yet:** it has no production authentication.

## Local development (works today)

Prerequisites: Node.js 22 or newer (24 used), Docker, corepack (ships with Node).

```bash
git clone https://github.com/shivambhadane/corven.git && cd corven
corepack enable
pnpm install                       # build scripts: esbuild is pre-approved in pnpm-workspace.yaml
docker compose up -d --wait        # PostgreSQL 17 on 127.0.0.1:54329 (local-only credentials)
export DATABASE_URL=postgres://corven:corven_local_only@127.0.0.1:54329/corven
pnpm --filter @corven/api db:migrate
```

Quality gates and tests:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Run the API (development authentication, **never for production**):

```bash
CORVEN_DEV_AUTH=1 pnpm --filter @corven/api start      # listens on 127.0.0.1:3001
```

Try it:

```bash
H='-H x-dev-actor-id:7f3c2a10-0000-4000-8000-000000000001 -H x-dev-org-id:7f3c2a10-0000-4000-8000-0000000000aa -H x-dev-role:operator -H content-type:application/json'
curl -s localhost:3001/health
curl -s -X POST localhost:3001/api/v1/agents $H -d '{"name":"support-agent","agentType":"llm"}'
curl -s localhost:3001/api/v1/graph $H
```

Without `CORVEN_DEV_AUTH=1` every `/api` request returns 401, and the server refuses to start with it when `NODE_ENV=production`.

Landing page: `cd apps/landing && python3 -m http.server 3000`.

Stop PostgreSQL: `docker compose stop` (keeps data) or `docker compose down` (removes the container).

## Migrations

`pnpm --filter @corven/api db:generate` creates a migration from `src/db/schema.ts`; for hand-written SQL use `drizzle-kit generate --custom`. Apply with `db:migrate`. Down scripts live in `apps/api/drizzle/down/` and are applied manually, newest first; they delete data.

## Cloud deployment (planned, not done)

Order of work once authentication exists:

1. **Database:** create the Neon project; set `DATABASE_URL` in the secret store; run migrations from CI or a one-off job.
2. **API:** build a Docker image; run it on the EC2 instance behind TLS (reverse proxy or Cloudflare); inject secrets from the platform; set `NODE_ENV=production`; verify `GET /health`.
3. **Frontend and landing:** deploy to Vercel (landing root directory `apps/landing`, no build command); point the dashboard at the API URL.
4. **Contracts:** deploy to Sepolia with Foundry; record addresses in configuration.
5. **Integrations:** configure RPC, ENS, Arkiv and CRE endpoints and keys as secrets.
6. **Verify:** health check, database connectivity, a full incident scenario end to end, budget alerts active.

## Rollback

Redeploy the previous image or Vercel deployment. Database rollbacks are not automatic: prefer forward-only fixes; the down scripts are for development.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `ERR_PNPM_IGNORED_BUILDS` | Run `pnpm approve-builds esbuild` (already recorded in `pnpm-workspace.yaml`) |
| Tests fail with "Cannot reach test PostgreSQL" | Start it: `docker compose up -d --wait` |
| All requests 401 | `CORVEN_DEV_AUTH=1` not set (intended) or dev headers missing or malformed |
| Port 54329 in use | Another container or service; stop it or change the compose port and `TEST_ADMIN_DATABASE_URL` |
