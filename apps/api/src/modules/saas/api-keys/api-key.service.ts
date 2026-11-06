import { createHash, randomBytes } from "node:crypto";
import type { Principal } from "../../../auth/principal.js";
import type { Database } from "../../../db/client.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../errors.js";
import type { ApiKeyRepository } from "./api-key.repository.js";
import type { ApiKeyDto, ApiKeyRecord, ApiKeyScope, CreateApiKeyInput, CreatedApiKeyDto } from "./api-key.types.js";

export function toApiKeyDto(r: ApiKeyRecord): ApiKeyDto {
  return {
    id: r.id,
    organizationId: r.organizationId,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  };
}

export class ApiKeyService {
  constructor(
    private readonly db: Database,
    private readonly repo: ApiKeyRepository,
  ) {}

  async createKey(principal: Principal, input: CreateApiKeyInput): Promise<CreatedApiKeyDto> {
    if (principal.role !== "admin" && principal.role !== "system") {
      throw new ForbiddenError("Only organization administrators can create API keys");
    }

    if (!input.name || input.name.trim().length === 0) {
      throw new ValidationError("Key name is required and cannot be blank");
    }

    const randomPart = randomBytes(24).toString("hex");
    const rawKey = `crv_live_${randomPart}`;
    const prefix = `crv_live_${randomPart.slice(0, 6)}`;
    const keyHash = createHash("sha256").update(rawKey).digest("hex");

    const scopes = (input.scopes && input.scopes.length > 0 ? input.scopes : ["*"]) as ApiKeyScope[];
    const expiresAt = input.expiresInDays && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const record = await this.repo.create(this.db, {
      organizationId: principal.organizationId,
      name: input.name.trim(),
      prefix,
      keyHash,
      scopes,
      expiresAt,
      createdBy: principal.actorId,
    });

    return {
      ...toApiKeyDto(record),
      rawKey,
    };
  }

  async listKeys(principal: Principal): Promise<ApiKeyDto[]> {
    const records = await this.repo.list(this.db, principal.organizationId);
    return records.map(toApiKeyDto);
  }

  async revokeKey(principal: Principal, id: string): Promise<ApiKeyDto> {
    if (principal.role !== "admin" && principal.role !== "system") {
      throw new ForbiddenError("Only organization administrators can revoke API keys");
    }

    const revoked = await this.repo.revoke(this.db, principal.organizationId, id, new Date());
    if (!revoked) {
      throw new NotFoundError("API key not found or already revoked");
    }
    return toApiKeyDto(revoked);
  }

  async authenticateRawKey(rawKey: string): Promise<Principal | null> {
    if (!rawKey.startsWith("crv_live_")) {
      return null;
    }

    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const record = await this.repo.findByHash(this.db, keyHash);
    if (!record) {
      return null;
    }

    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
      return null;
    }

    // Update last used asynchronously without blocking request
    void this.repo.touchLastUsed(this.db, record.id, new Date()).catch(() => {});

    const role = record.scopes.includes("*") || record.scopes.includes("containment:execute")
      ? "admin"
      : "operator";

    return {
      actorId: record.createdBy,
      organizationId: record.organizationId,
      role,
    };
  }
}
