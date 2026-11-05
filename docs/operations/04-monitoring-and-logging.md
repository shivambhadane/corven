# Monitoring and Logging

## Today

- **Structured logs** from Fastify's pino logger (JSON). Request logging is on when the server starts via `server.ts`; tests run with logging off.
- **Never logged:** request bodies, credentials, private keys.
- **Graph builds** log node and edge counts, the number of integrity issues and the build duration, and `POST /graph/build` returns the duration.
- **Server-side failures:** any `AppError` with status 500 and any unexpected error is logged with its cause; clients only see a generic message.
- **Health:** `GET /health` (public) returns `{ "status": "ok" }`. It does not yet check database connectivity.
- **Warnings at startup:** the server logs when dev authentication is enabled and when no production authenticator is configured.

## Gaps

No metrics, no tracing, no alerting, no log shipping, no dashboards, no readiness check that touches the database, no request id correlation beyond pino's default, no audit-log read API.

## Planned

| Area | Plan |
|---|---|
| Health | `/health/live` and `/health/ready` (database reachable, migrations current) |
| Metrics | Request rate, latency, error rate by code; graph build time and size; incident state counts; job queue depth; enforcement and verification outcomes; integration failures (chain, Arkiv, ENS, CRE) |
| Structured events | One log event per state change with incident id, organization id (not user data) and outcome |
| Observability of correctness | Count of rejected discovery observations by reason code; unresolved and conflicting findings; stale sources |
| Alerting | Failed or partial containment, failed verification, integration outage during an incident, repeated 5xx, migration failure |
| Retention | Application logs short-lived and free of secrets; audit and evidence data governed by the data retention policy (not written yet) |

## Logging rules

1. JSON, one line per event, with a stable field set.
2. Include `organizationId` and request or incident id for correlation; exclude secrets and raw payloads.
3. Log at the boundary where the failure is understood, not at every layer.
4. Log security events (denied operations, failed recovery attempts, rejected approvals) distinctly so they can be alerted on.
5. Truncation and limits hit (graph searches, path caps) are reported in responses, and counted in metrics when they exist.

## Cost note

For the hackathon, a hosted log viewer or the platform's own log tooling is enough. Avoid paid observability stacks.
