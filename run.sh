#!/usr/bin/env bash
# CORVEN: start everything locally.
#
#   ./run.sh          install, start PostgreSQL, migrate, build the console, run the API
#                     -> landing page  http://127.0.0.1:3001/
#                     -> console       http://127.0.0.1:3001/console/
#   ./run.sh dev      same, but the API reloads on change and the console runs on Vite (http://127.0.0.1:5173/console/)
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

say "starting PostgreSQL (docker compose)"
docker compose up -d --wait >/dev/null

say "installing dependencies"
pnpm install --frozen-lockfile --silent

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
  say "console (Vite)  -> http://127.0.0.1:5173/console/"
  pnpm --filter @corven/console dev --host 127.0.0.1 &
  PIDS="$!"
  say "API (watch)     -> http://127.0.0.1:${PORT}/  (landing)"
  pnpm --filter @corven/api dev &
  PIDS="$PIDS $!"
  wait
else
  say "building the console"
  pnpm --filter @corven/console build >/dev/null
  say "CORVEN is starting"
  say "  landing page  http://127.0.0.1:${PORT}/"
  say "  console       http://127.0.0.1:${PORT}/console/"
  say "  health        http://127.0.0.1:${PORT}/health"
  pnpm --filter @corven/api start
fi
