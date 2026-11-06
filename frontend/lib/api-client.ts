export type Role = "admin" | "operator" | "approver" | "viewer";

export interface CorvenUser {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
}

export interface OrganizationMembership {
  organizationId: string;
  name: string;
  slug: string;
  tier: "starter" | "pro" | "enterprise";
  role: Role;
}

export interface PendingInvitation {
  id: string;
  organizationId: string;
  organizationName: string;
  role: Role;
  invitedAt: string;
}

export interface MeData {
  user: CorvenUser;
  memberships: OrganizationMembership[];
  invitations: PendingInvitation[];
}

export interface DevSession {
  actorId: string;
  organizationId: string;
  organizationName: string;
  role: Role;
  tier: "starter" | "pro" | "enterprise";
}

export interface DemoSession {
  token: string;
  organizationId: string;
  persona: Role;
  expiresAt?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T = unknown>(
  method: string,
  path: string,
  options: {
    token?: string | null;
    orgId?: string | null;
    devSession?: DevSession | null;
    demoSession?: DemoSession | null;
    body?: unknown;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  if (options.token) {
    headers["authorization"] = `Bearer ${options.token}`;
  }
  if (options.orgId) {
    headers["x-corven-org-id"] = options.orgId;
  }

  if (options.devSession) {
    headers["x-dev-actor-id"] = options.devSession.actorId;
    headers["x-dev-org-id"] = options.devSession.organizationId;
    headers["x-dev-role"] = options.devSession.role;
  }

  if (options.demoSession) {
    headers["x-corven-demo"] = options.demoSession.token;
    headers["x-corven-demo-persona"] = options.demoSession.persona;
  }

  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let json: { data?: T; error?: { code?: string; message?: string; details?: unknown } } | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON response
  }

  if (!res.ok) {
    throw new ApiError(
      res.status,
      json?.error?.code ?? `HTTP_${res.status}`,
      json?.error?.message ?? (res.statusText || "Request failed"),
      json?.error?.details,
    );
  }

  return (json?.data !== undefined ? json.data : (json as unknown as T)) as T;
}

export const corvenApi = {
  getMe: (token: string, devSession?: DevSession | null) =>
    apiRequest<MeData>("GET", "/me", { token, devSession }),

  createOrganization: (
    token: string,
    params: { name: string; website?: string },
    devSession?: DevSession | null,
  ) =>
    apiRequest<OrganizationMembership>("POST", "/me/organizations", {
      token,
      devSession,
      body: params,
    }),

  acceptInvitation: (token: string, invitationId: string, devSession?: DevSession | null) =>
    apiRequest<{ accepted: boolean }>("POST", `/me/invitations/${invitationId}/accept`, {
      token,
      devSession,
    }),

  declineInvitation: (token: string, invitationId: string, devSession?: DevSession | null) =>
    apiRequest<{ declined: boolean }>("POST", `/me/invitations/${invitationId}/decline`, {
      token,
      devSession,
    }),

  startDemoSession: () =>
    apiRequest<{ token: string; organizationId: string; expiresAt: string }>("POST", "/demo/sessions"),
};
