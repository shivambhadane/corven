# Verification model

## Checks

Each check stores its category, purpose (`security` or `continuity`), target agent, resource and action, what was **expected**, what was **actually observed**, the result, details (reason codes, observation, errors), an execution reference (the gateway decision id or enforcement action id) and any coverage limitation. Checks are append-only.

## Aggregation

| Run status | Rule |
|---|---|
| `passed` | every check passed |
| `inconclusive` | no checks, no security checks, or every check inconclusive |
| `failed` | no check of the malicious path itself (negative access, permission persistence, path block) passed, and at least one failed |
| `partially_verified` | anything else: some paths still open, healthy paths broken, or some checks inconclusive |

Bypass resistance is a security check but describes the environment, not the path, so it can never make a run count as "something was blocked".

A protected resource that no healthy agent can use has no healthy path to preserve. It gets no health check, and the summary lists it under `notChecked`.

## Evidence integrity

When a run completes, `result_hash` = SHA-256 of the canonical JSON of its checks (observations only, no ids or timestamps). `GET /verification/:id` recomputes it and returns `resultHashMatches`. A completed run is final (trigger): status, summary and hash cannot change. Tampering with a check behind the triggers is detected (tested).
