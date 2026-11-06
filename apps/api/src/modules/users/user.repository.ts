import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Executor } from "../../db/client.js";
import { organizationMembers, organizations, users } from "../../db/schema.js";

export interface UserRecord {
  id: string;
  firebaseUid: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  lastLoginAt: Date;
}

export interface MembershipRecord {
  organizationId: string;
  organizationName: string;
  slug: string;
  tier: string;
  role: "admin" | "operator" | "approver" | "viewer";
}

const toUser = (r: typeof users.$inferSelect): UserRecord => ({ id: r.id, firebaseUid: r.firebaseUid, email: r.email, emailVerified: r.emailVerified, displayName: r.displayName, lastLoginAt: r.lastLoginAt });

export class UserRepository {
  async findByFirebaseUid(db: Executor, uid: string): Promise<UserRecord | null> {
    const [row] = await db.select().from(users).where(eq(users.firebaseUid, uid));
    return row ? toUser(row) : null;
  }

  /** Concurrent first requests from the same person insert once; the loser re-reads. */
  async insertIfAbsent(db: Executor, v: { firebaseUid: string; email: string; emailVerified: boolean; displayName: string | null }): Promise<void> {
    await db.insert(users).values(v).onConflictDoNothing({ target: users.firebaseUid });
  }

  async touch(db: Executor, id: string, v: { email: string; emailVerified: boolean; displayName: string | null }): Promise<UserRecord> {
    const [row] = await db.update(users).set({ ...v, lastLoginAt: new Date() }).where(eq(users.id, id)).returning();
    return toUser(row!);
  }

  /** Pending invitations addressed to an email. */
  async pendingInvitations(db: Executor, email: string): Promise<Array<MembershipRecord & { invitationId: string; invitedAt: Date }>> {
    const rows = await db
      .select({ invitationId: organizationMembers.id, invitedAt: organizationMembers.createdAt, organizationId: organizations.id, organizationName: organizations.name, slug: organizations.slug, tier: organizations.tier, role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(and(eq(organizationMembers.status, "invited"), sql`lower(${organizationMembers.email}) = lower(${email})`))
      .orderBy(asc(organizationMembers.createdAt));
    return rows as Array<MembershipRecord & { invitationId: string; invitedAt: Date }>;
  }

  /** Only the addressee can act on an invitation, and only while it is still pending. */
  async acceptInvitation(db: Executor, invitationId: string, email: string): Promise<boolean> {
    const rows = await db
      .update(organizationMembers)
      .set({ status: "active" })
      .where(and(eq(organizationMembers.id, invitationId), eq(organizationMembers.status, "invited"), sql`lower(${organizationMembers.email}) = lower(${email})`))
      .returning({ id: organizationMembers.id });
    return rows.length === 1;
  }

  async declineInvitation(db: Executor, invitationId: string, email: string): Promise<boolean> {
    const rows = await db
      .delete(organizationMembers)
      .where(and(eq(organizationMembers.id, invitationId), eq(organizationMembers.status, "invited"), sql`lower(${organizationMembers.email}) = lower(${email})`))
      .returning({ id: organizationMembers.id });
    return rows.length === 1;
  }

  /** Active memberships of a verified email, oldest first so the default organization is stable. */
  async activeMemberships(db: Executor, email: string): Promise<MembershipRecord[]> {
    const rows = await db
      .select({ organizationId: organizations.id, organizationName: organizations.name, slug: organizations.slug, tier: organizations.tier, role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(and(eq(organizationMembers.status, "active"), sql`lower(${organizationMembers.email}) = lower(${email})`))
      .orderBy(asc(organizationMembers.createdAt), asc(organizations.id));
    return rows as MembershipRecord[];
  }

  async countAdminMemberships(db: Executor, email: string): Promise<number> {
    const rows = await db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(and(inArray(organizationMembers.status, ["active", "invited"]), eq(organizationMembers.role, "admin"), sql`lower(${organizationMembers.email}) = lower(${email})`));
    return rows.length;
  }
}
