import { randomBytes } from "node:crypto";
import type { Database } from "../../db/client.js";
import type { FirebaseIdentity } from "../../auth/firebase.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../errors.js";
import type { OrganizationRepository } from "../saas/organizations/organization.repository.js";
import type { OrganizationService } from "../saas/organizations/organization.service.js";
import { UserRepository, type MembershipRecord, type UserRecord } from "./user.repository.js";

/** Self-serve limit: how many organizations one person may administer. Raise it deliberately; it exists to stop signup abuse. */
export const MAX_ADMIN_ORGANIZATIONS = 3;
/** Rewrite the user row at most this often when nothing changed, so authentication is not a write per request. */
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "org";

export class UserService {
  constructor(
    private readonly db: Database,
    readonly repo: UserRepository,
    private readonly organizations: OrganizationService,
    private readonly orgRepo: OrganizationRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Finds or creates the person behind a verified Firebase identity and keeps their email and verification state current. */
  async signIn(identity: FirebaseIdentity): Promise<UserRecord> {
    let user = await this.repo.findByFirebaseUid(this.db, identity.uid);
    if (!user) {
      await this.repo.insertIfAbsent(this.db, { firebaseUid: identity.uid, email: identity.email, emailVerified: identity.emailVerified, displayName: identity.name });
      user = (await this.repo.findByFirebaseUid(this.db, identity.uid))!;
    }
    const changed = user.email !== identity.email || user.emailVerified !== identity.emailVerified || user.displayName !== identity.name;
    if (changed || this.now().getTime() - user.lastLoginAt.getTime() > TOUCH_INTERVAL_MS) {
      user = await this.repo.touch(this.db, user.id, { email: identity.email, emailVerified: identity.emailVerified, displayName: identity.name });
    }
    return user;
  }

  /** Access comes from ACTIVE membership of a VERIFIED email only. Invitations grant nothing until accepted. */
  async memberships(user: Pick<UserRecord, "email" | "emailVerified">): Promise<MembershipRecord[]> {
    if (!user.emailVerified) return [];
    return this.repo.activeMemberships(this.db, user.email);
  }

  /** An unverified address never sees, accepts or declines an invitation. */
  async invitations(user: Pick<UserRecord, "email" | "emailVerified">) {
    return user.emailVerified ? this.repo.pendingInvitations(this.db, user.email) : [];
  }

  async respondToInvitation(user: UserRecord, invitationId: string, accept: boolean): Promise<void> {
    if (!user.emailVerified) throw new ForbiddenError("Verify your email address first");
    const ok = accept ? await this.repo.acceptInvitation(this.db, invitationId, user.email) : await this.repo.declineInvitation(this.db, invitationId, user.email);
    if (!ok) throw new NotFoundError("Invitation not found");
  }

  async createOrganization(user: UserRecord, name: string, website?: string): Promise<MembershipRecord> {
    if (!user.emailVerified) throw new ForbiddenError("Verify your email address before creating an organization");
    if ((await this.repo.countAdminMemberships(this.db, user.email)) >= MAX_ADMIN_ORGANIZATIONS) {
      throw new ConflictError(`You can administer at most ${MAX_ADMIN_ORGANIZATIONS} organizations`, "ORGANIZATION_LIMIT");
    }
    const base = slugify(name);
    let slug = base;
    for (let i = 0; i < 5 && (await this.orgRepo.findBySlug(this.db, slug)); i++) slug = `${base.slice(0, 50)}-${randomBytes(3).toString("hex")}`;
    // Plan tier is never chosen by the caller: self-serve organizations start on the starter plan.
    const org = await this.organizations.createOrganization(user.id, user.email, { name, slug });
    if (website) await this.orgRepo.updateOrganization(this.db, org.id, { settings: { website } });
    return { organizationId: org.id, organizationName: org.name, slug: org.slug, tier: org.tier, role: "admin" };
  }
}
