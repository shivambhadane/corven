#!/usr/bin/env bash
# CORVEN: start everything locally.
#
#   ./run.sh          install, start PostgreSQL, migrate, build the web app, run the API
#                     -> landing page  http://localhost:3000/        (frontend/, Next.js)
#                     -> marketplace   http://localhost:3000/marketplace
#                     -> API           http://127.0.0.1:3001/api/v1/  (the website proxies /api/v1 to it)
#   ./run.sh dev      same, with hot reload for both the API and the website
#   ./run.sh check    typecheck, lint, the full test suite and the contract tests (needs PostgreSQL; starts it)
#   ./run.sh smoke    end-to-end test against a running ./run.sh (landing, console, full incident response, Arkiv)
#   ./run.sh stop     stop PostgreSQL
#
# Secrets come from ./.env (git-ignored) and are never printed. Development sign-in is enabled (CORVEN_DEV_AUTH=1):
# this is a LOCAL setup only and must never be exposed to a network.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
MODE="${1:-start}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required ($2)"; }

need node "Node.js 22 or newer"
need pnpm "corepack enable && corepack prepare pnpm@latest --activate"
need docker "Docker with the compose plugin"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || die "Node.js 22 or newer is required"
export PATH="$PATH:$HOME/.foundry/bin"

if [ "$MODE" = "stop" ]; then docker compose stop; exit 0; fi
if [ "$MODE" = "smoke" ]; then exec node scripts/smoke-e2e.mjs "http://127.0.0.1:${PORT:-3001}"; fi

# Load .env without echoing anything; then local-only defaults for what is not set.
if [ -f .env ]; then set -a; . ./.env; set +a; else say "no .env found: Arkiv and Ethereum stay unconfigured"; fi
export DATABASE_URL="${DATABASE_URL:-postgres://corven:corven_local_only@127.0.0.1:54329/corven}"
export PORT="${PORT:-3001}"
export NODE_ENV="${NODE_ENV:-development}"
[ "$NODE_ENV" = "production" ] && die "run.sh is for local development; it enables development sign-in"
export CORVEN_DEV_AUTH=1

port_busy() { timeout 2 bash -c "exec 3<>/dev/tcp/127.0.0.1/$1" 2>/dev/null; }
if [ "$MODE" = "start" ] || [ "$MODE" = "dev" ]; then
  if port_busy "$PORT"; then
    if curl -sf --max-time 3 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
      die "CORVEN is already running on port ${PORT} (http://127.0.0.1:${PORT}/). Stop it first, or use PORT=3002 ./run.sh"
    fi
    die "port ${PORT} is in use by a program that is not answering (see: ss -ltnp | grep :${PORT}). Stop it, or use PORT=3002 ./run.sh"
  fi
  if port_busy "${WEB_PORT:-3000}"; then die "port ${WEB_PORT:-3000} (website) is in use. Free it, or use WEB_PORT=3002 ./run.sh"; fi
fi

say "starting PostgreSQL (docker compose)"
docker compose up -d --wait >/dev/null

say "installing dependencies"
pnpm install --frozen-lockfile --silent
(cd frontend && npm ci --silent --no-audit --no-fund)

if [ "$MODE" = "check" ]; then
  say "typecheck";  pnpm -r typecheck
  say "lint";       pnpm --filter @corven/api lint
  say "tests";      pnpm --filter @corven/api test
  if command -v forge >/dev/null 2>&1 && [ -d contracts/lib/openzeppelin-contracts ]; then say "contracts"; (cd contracts && forge test); else say "skipping contracts (forge or contracts/lib missing)"; fi
  say "all checks passed"; exit 0
fi

say "applying database migrations"
pnpm --filter @corven/api db:migrate >/dev/null

say "Arkiv: $( [ -n "${ARKIV_ACCESS_KEY:-}" ] && echo "access key set" || echo "no access key" ), $( [ -n "${ARKIV_SIGNER_PRIVATE_KEY:-}" ] && echo "signer set" || echo "no signer (read-only)" )"

cleanup() { trap - INT TERM EXIT; [ -n "${PIDS:-}" ] && kill $PIDS 2>/dev/null || true; }
trap cleanup INT TERM EXIT

if [ "$MODE" = "dev" ]; then
  say "website (Next, hot reload) -> http://localhost:${WEB_PORT:-3000}/"
  (cd frontend && NODE_ENV=development CORVEN_API_URL="http://127.0.0.1:${PORT}" npx next dev -p "${WEB_PORT:-3000}") &
  PIDS="$!"
  say "API (watch)     -> http://127.0.0.1:${PORT}/api/"
  pnpm --filter @corven/api dev &
  PIDS="$PIDS $!"
  wait
else
  say "building the website (frontend/)"
  (cd frontend && NODE_ENV=production CORVEN_API_URL="http://127.0.0.1:${PORT}" npx next build >/dev/null)
  say "CORVEN is starting"
  say "  API           http://127.0.0.1:${PORT}/api/v1/"
  say "  website       http://localhost:${WEB_PORT:-3000}/"
  say "  login         http://localhost:${WEB_PORT:-3000}/login"
  say "  dashboard     http://localhost:${WEB_PORT:-3000}/dashboard"
  say "  marketplace   http://localhost:${WEB_PORT:-3000}/marketplace"
  (cd frontend && NODE_ENV=production npx next start -p "${WEB_PORT:-3000}") &
  PIDS="$!"
  say "  health        http://127.0.0.1:${PORT}/health"
  pnpm --filter @corven/api start
fi
