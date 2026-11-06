# Enterprise Webhooks & Real-Time Outbound Event Pipeline

## 1. Overview

CORVEN dispatches signed HTTP webhook notifications to customer endpoints (SIEM tools, Slack bots, PagerDuty, automated ticketing systems) upon critical incident response lifecycle events.

---

## 2. Event Catalog

| Event Name | Trigger |
|---|---|
| `incident.detected` | A compromised agent or high-severity anomaly is opened. |
| `incident.investigating` | Analysis begins, pinned graph snapshot captured. |
| `containment.planned` | Min-cut calculation finishes with feasible actions. |
| `approval.requested` | Human authorization required to execute cut-set. |
| `approval.decided` | Plan approved or rejected by authorized approver. |
| `enforcement.completed` | Revocations executed across enforcement points. |
| `verification.completed` | Active gateway probes confirm containment status (`passed` / `failed`). |
| `evidence.sealed` | Cryptographic evidence package created and hash-chained. |
| `evidence.anchored` | Hash anchored to Arkiv Rabdi or Ethereum Sepolia. |

---

## 3. Cryptographic Signature & Verification (`X-Corven-Signature`)

To prevent spoofing and tampering, every webhook delivery includes an HMAC-SHA256 signature in the request headers:

```http
POST /webhook HTTP/1.1
Host: customer-security-gateway.com
Content-Type: application/json
X-Corven-Delivery: d8b5d3a2-11e4-4c8d-90c7-2b10a9f5d1e2
X-Corven-Timestamp: 1793971200
X-Corven-Signature: t=1793971200,v1=9c4a8f1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f
```

### Signature Computation:
$$\text{signedPayload} = t + "." + \text{rawBody}$$
$$\text{expectedSignature} = \text{HMAC-SHA256}(\text{webhookSecret}, \text{signedPayload})$$

Customers verify the delivery by computing the HMAC over the timestamp and raw body, preventing replay attacks when timestamp drift exceeds 300 seconds.

---

## 4. Delivery Retry Policy

Webhooks are queued and dispatched via `pg-boss`:
- **Timeout**: 10 seconds per HTTP POST.
- **Retry Schedule**: Exponential backoff with jitter (5 retries: 10s, 30s, 2m, 10m, 1h).
- **Dead-Letter Handling**: After 5 failed attempts, the delivery is logged as `failed` with response code and error summary for customer inspection.
