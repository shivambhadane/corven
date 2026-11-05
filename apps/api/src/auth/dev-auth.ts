import { ROLES, type Authenticator, type Role } from "./principal.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function header(h: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * DEVELOPMENT / TEST ONLY. Trusts caller-supplied headers. This is NOT
 * authentication and must never be enabled in production; server.ts refuses to
 * enable it when NODE_ENV=production.
 */
export const devHeaderAuthenticator: Authenticator = (headers) => {
  const actorId = header(headers, "x-dev-actor-id");
  const organizationId = header(headers, "x-dev-org-id");
  const role = header(headers, "x-dev-role");
  if (!actorId || !organizationId || !role) return null;
  if (!UUID.test(actorId) || !UUID.test(organizationId)) return null;
  if (!(ROLES as readonly string[]).includes(role)) return null;
  return { actorId, organizationId, role: role as Role };
};

/** Default authenticator: rejects every request until real auth exists. */
export const failClosedAuthenticator: Authenticator = () => null;
