/** `approver` is the Incident Approver: reads everything an operator can and decides containment approvals, but changes nothing else. */
export const ROLES = ["admin", "operator", "viewer", "approver"] as const;
export type Role = (typeof ROLES)[number];

/**
 * The authenticated caller. `organizationId` ALWAYS comes from here and never
 * from a request body, query string or URL.
 */
export interface Principal {
  actorId: string;
  organizationId: string;
  /** "system" is for internal modules (e.g. discovery); it can never come from an HTTP request. */
  role: Role | "system";
}

export type Authenticator = (headers: Record<string, string | string[] | undefined>) => Principal | null;
