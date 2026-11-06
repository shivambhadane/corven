# Customer API Keys & Machine-to-Machine (M2M) Authentication

## 1. Key Structure & Token Format

For machine-to-machine integration (CI/CD pipelines, runtime agent frameworks like LangChain, CrewAI, AutoGen, or custom autonomous services), CORVEN provides high-entropy API keys following standard modern security conventions:

$$\text{Key Format: } \texttt{crv\_live\_[32-byte-hex-random]}$$

Example:
`crv_live_7f8c9b1a0d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a`

### Security Characteristics:
- **Prefix Scanning**: The `crv_live_` prefix allows GitHub Secret Scanning, GitGuardian, and custom DLP tools to identify leaked tokens automatically.
- **One-Way Cryptographic Storage**: Raw API keys are displayed **only once** upon generation. The database stores only the SHA-256 hash of the token:
  $$\text{keyHash} = \text{SHA-256}(\text{rawKey})$$
- **Fast Prefix Lookup**: The database indexes `(organization_id, prefix)` for efficient, constant-time validation.

---

## 2. Granular Capability Scopes

Each API key is restricted to explicit scopes:

| Scope | Allowed Operations |
|---|---|
| `agent:read` | Query registered agents and identities |
| `agent:write` | Register new agents, update capabilities and declared metadata |
| `dependency:read` | Export topology subgraphs and dependency metadata |
| `dependency:write` | Register runtime dependencies (authority, resource, operational) |
| `discovery:ingest` | Ingest config manifests, runtime access logs, or framework definitions |
| `incident:write` | Open new security incidents from external anomaly detection systems |
| `evidence:read` | Retrieve sealed audit packages and verify Merkle hash chains |

---

## 3. Request Header Specification

Clients authenticate by supplying the API key in standard headers:

```http
Authorization: Bearer crv_live_7f8c9b1a0d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a
```
or via the custom header:
```http
X-API-Key: crv_live_7f8c9b1a0d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a
```

When verified:
1. The server computes `SHA-256(rawKey)`.
2. Queries active, non-expired keys matching the hash.
3. Updates `last_used_at` asynchronously.
4. Binds the request context to the key's `organizationId` and mapped permissions.
