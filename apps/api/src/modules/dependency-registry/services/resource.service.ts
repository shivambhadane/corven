import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import type { Database } from "../../../db/client.js";
import { ConflictError, NotFoundError } from "../../../errors.js";
import { pgError } from "../../agent-registry/services/shared.js";
import type { ResourceRepository } from "../repositories/resource.repository.js";
import type { Resource, ResourceType } from "../types/dependency.types.js";

/** Minimum resource support: create and read. No update or delete in this module. */
export class ResourceService {
  constructor(
    private readonly db: Database,
    private readonly repo: ResourceRepository,
  ) {}

  async create(principal: Principal, input: { name: string; resourceType: ResourceType; description?: string | undefined }): Promise<Resource> {
    assertCan(principal, "resource:write");
    try {
      return await this.repo.insert(this.db, {
        organizationId: principal.organizationId,
        name: input.name.trim(),
        resourceType: input.resourceType,
        description: input.description?.trim() || null,
      });
    } catch (err) {
      const { code, constraint } = pgError(err);
      if (code === "23505" && constraint === "resources_org_name_unique") {
        throw new ConflictError("A resource with this name already exists in your organization", "RESOURCE_NAME_CONFLICT");
      }
      throw err;
    }
  }

  async get(principal: Principal, id: string): Promise<Resource> {
    assertCan(principal, "resource:read");
    const r = await this.repo.find(this.db, principal.organizationId, id);
    if (!r) throw new NotFoundError("Resource not found");
    return r;
  }

  async list(principal: Principal, page: { limit: number; offset: number }): Promise<{ items: Resource[]; total: number }> {
    assertCan(principal, "resource:read");
    return this.repo.list(this.db, principal.organizationId, page);
  }
}
