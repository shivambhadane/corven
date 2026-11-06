import type { Principal } from "../../../auth/principal.js";
import type { Database } from "../../../db/client.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../../errors.js";
import type { OrganizationRepository } from "./organization.repository.js";
import type {
  CreateOrganizationInput,
  InviteMemberInput,
  OrganizationDto,
  OrganizationMemberDto,
  OrganizationMemberRecord,
  OrganizationRecord,
  UpdateOrganizationInput,
} from "./organization.types.js";

export function toOrgDto(r: OrganizationRecord): OrganizationDto {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    tier: r.tier,
    planStatus: r.planStatus,
    settings: r.settings,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toMemberDto(r: OrganizationMemberRecord): OrganizationMemberDto {
  return {
    id: r.id,
    organizationId: r.organizationId,
    email: r.email,
    role: r.role,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  };
}

export class OrganizationService {
  constructor(
    private readonly db: Database,
    private readonly repo: OrganizationRepository,
  ) {}

  async createOrganization(actorId: string, actorEmail: string, input: CreateOrganizationInput): Promise<OrganizationDto> {
    const slug = input.slug.toLowerCase().trim();
    if (!/^[a-z0-9-]+$/.test(slug)) {
      throw new ValidationError("Slug must contain only lowercase letters, numbers, and hyphens");
    }

    const existing = await this.repo.findBySlug(this.db, slug);
    if (existing) {
      throw new ConflictError(`Organization with slug '${slug}' already exists`);
    }

    return await this.db.transaction(async (tx) => {
      const org = await this.repo.createOrganization(tx, {
        name: input.name.trim(),
        slug,
        tier: input.tier ?? "starter",
        planStatus: "active",
        settings: {},
      });

      // Add creating user as the first admin member
      await this.repo.addMember(tx, {
        organizationId: org.id,
        email: actorEmail.toLowerCase().trim(),
        role: "admin",
        status: "active",
      });

      return toOrgDto(org);
    });
  }

  async getOrganization(principal: Principal): Promise<OrganizationDto> {
    const org = await this.repo.findById(this.db, principal.organizationId);
    if (!org) {
      throw new NotFoundError("Organization not found");
    }
    return toOrgDto(org);
  }

  async updateOrganization(principal: Principal, input: UpdateOrganizationInput): Promise<OrganizationDto> {
    if (principal.role !== "admin" && principal.role !== "system") {
      throw new ForbiddenError("Only organization administrators can update organization settings");
    }

    const updated = await this.repo.updateOrganization(this.db, principal.organizationId, {
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(input.settings ? { settings: input.settings } : {}),
    });

    if (!updated) {
      throw new NotFoundError("Organization not found");
    }
    return toOrgDto(updated);
  }

  async listMembers(principal: Principal): Promise<OrganizationMemberDto[]> {
    const members = await this.repo.listMembers(this.db, principal.organizationId);
    return members.map(toMemberDto);
  }

  async inviteMember(principal: Principal, input: InviteMemberInput): Promise<OrganizationMemberDto> {
    if (principal.role !== "admin" && principal.role !== "system") {
      throw new ForbiddenError("Only organization administrators can invite members");
    }

    const email = input.email.toLowerCase().trim();
    if (!email.includes("@")) {
      throw new ValidationError("A valid email address is required");
    }

    const existing = await this.repo.findMemberByEmail(this.db, principal.organizationId, email);
    if (existing) {
      throw new ConflictError("Member with this email already belongs to the organization");
    }

    const created = await this.repo.addMember(this.db, {
      organizationId: principal.organizationId,
      email,
      role: input.role,
      // Access starts only when the invited person signs in with this verified address and accepts.
      status: "invited",
    });

    return toMemberDto(created);
  }

  async removeMember(principal: Principal, memberId: string): Promise<OrganizationMemberDto> {
    if (principal.role !== "admin" && principal.role !== "system") {
      throw new ForbiddenError("Only organization administrators can remove members");
    }

    const removed = await this.repo.removeMember(this.db, principal.organizationId, memberId);
    if (!removed) {
      throw new NotFoundError("Member not found in organization");
    }
    return toMemberDto(removed);
  }
}
