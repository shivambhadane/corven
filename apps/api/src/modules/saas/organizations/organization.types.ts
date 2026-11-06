export const ORG_TIERS = ["starter", "pro", "enterprise"] as const;
export type OrgTier = (typeof ORG_TIERS)[number];

export const PLAN_STATUSES = ["active", "past_due", "cancelled"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const MEMBER_ROLES = ["admin", "operator", "approver", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_STATUSES = ["active", "invited", "suspended"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  tier: OrgTier;
  planStatus: PlanStatus;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMemberRecord {
  id: string;
  organizationId: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  createdAt: Date;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  tier?: OrgTier;
}

export interface UpdateOrganizationInput {
  name?: string;
  settings?: Record<string, unknown>;
}

export interface InviteMemberInput {
  email: string;
  role: MemberRole;
}

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  tier: OrgTier;
  planStatus: PlanStatus;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMemberDto {
  id: string;
  organizationId: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  createdAt: string;
}
