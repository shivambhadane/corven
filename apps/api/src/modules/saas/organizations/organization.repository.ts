import { and, asc, eq, sql } from "drizzle-orm";
import type { Executor } from "../../../db/client.js";
import { organizationMembers, organizations } from "../../../db/schema.js";
import type {
  MemberRole,
  MemberStatus,
  OrganizationMemberRecord,
  OrganizationRecord,
  OrgTier,
  PlanStatus,
} from "./organization.types.js";

const toOrgRecord = (r: typeof organizations.$inferSelect): OrganizationRecord => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  tier: r.tier as OrgTier,
  planStatus: r.planStatus as PlanStatus,
  settings: (r.settings as Record<string, unknown>) ?? {},
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const toMemberRecord = (r: typeof organizationMembers.$inferSelect): OrganizationMemberRecord => ({
  id: r.id,
  organizationId: r.organizationId,
  email: r.email,
  role: r.role as MemberRole,
  status: r.status as MemberStatus,
  createdAt: r.createdAt,
});

export class OrganizationRepository {
  async createOrganization(db: Executor, record: typeof organizations.$inferInsert): Promise<OrganizationRecord> {
    const [row] = await db.insert(organizations).values(record).returning();
    return toOrgRecord(row!);
  }

  async findById(db: Executor, id: string): Promise<OrganizationRecord | null> {
    const [row] = await db.select().from(organizations).where(eq(organizations.id, id));
    return row ? toOrgRecord(row) : null;
  }

  async findBySlug(db: Executor, slug: string): Promise<OrganizationRecord | null> {
    const [row] = await db
      .select()
      .from(organizations)
      .where(sql`lower(${organizations.slug}) = lower(${slug})`);
    return row ? toOrgRecord(row) : null;
  }

  async updateOrganization(
    db: Executor,
    id: string,
    patch: Partial<Pick<typeof organizations.$inferInsert, "name" | "tier" | "planStatus" | "settings">>,
  ): Promise<OrganizationRecord | null> {
    const [row] = await db
      .update(organizations)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();
    return row ? toOrgRecord(row) : null;
  }

  async addMember(db: Executor, record: typeof organizationMembers.$inferInsert): Promise<OrganizationMemberRecord> {
    const [row] = await db.insert(organizationMembers).values(record).returning();
    return toMemberRecord(row!);
  }

  async findMemberByEmail(db: Executor, organizationId: string, email: string): Promise<OrganizationMemberRecord | null> {
    const [row] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          sql`lower(${organizationMembers.email}) = lower(${email})`,
        ),
      );
    return row ? toMemberRecord(row) : null;
  }

  async listMembers(db: Executor, organizationId: string): Promise<OrganizationMemberRecord[]> {
    const rows = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, organizationId))
      .orderBy(asc(organizationMembers.createdAt));
    return rows.map(toMemberRecord);
  }

  async removeMember(db: Executor, organizationId: string, memberId: string): Promise<OrganizationMemberRecord | null> {
    const [row] = await db
      .delete(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.id, memberId),
        ),
      )
      .returning();
    return row ? toMemberRecord(row) : null;
  }
}
