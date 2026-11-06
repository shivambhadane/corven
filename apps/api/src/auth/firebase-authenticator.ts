import type { Authenticator } from "./principal.js";
import type { FirebaseVerifier } from "./firebase.js";
import type { UserService } from "../modules/users/user.service.js";

const header = (h: Record<string, string | string[] | undefined>, name: string): string | undefined => {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
};

export const bearerToken = (headers: Record<string, string | string[] | undefined>): string | null => {
  const v = header(headers, "authorization");
  if (!v || !/^Bearer\s+\S+$/i.test(v)) return null;
  const token = v.replace(/^Bearer\s+/i, "").trim();
  // Machine credentials have their own authenticators; never send them to the Firebase verifier.
  return token.startsWith("crv_live_") || token.startsWith("cvn_") ? null : token;
};

/**
 * Human authentication for the console: a Firebase ID token proves who the person is; CORVEN decides what they may do.
 * The organization and role come from the person's membership row, never from the token or the request. A person who
 * belongs to several organizations picks one with `x-corven-org-id`, which is honoured only if they are an active member.
 */
export function createFirebaseAuthenticator(verifier: FirebaseVerifier, users: UserService): Authenticator {
  return async (headers) => {
    const token = bearerToken(headers);
    if (!token) return null;
    const identity = await verifier.verify(token);
    if (!identity || !identity.emailVerified) return null;
    const user = await users.signIn(identity);
    const memberships = await users.memberships(user);
    const wanted = header(headers, "x-corven-org-id");
    const chosen = wanted ? memberships.find((m) => m.organizationId === wanted) : memberships[0];
    if (!chosen) return null;
    return { actorId: user.id, organizationId: chosen.organizationId, role: chosen.role };
  };
}

/** Identity only, no organization: used by the routes that run before a person belongs to one (`/me`, creating the first organization). */
export function createUserResolver(verifier: FirebaseVerifier, users: UserService) {
  return async (headers: Record<string, string | string[] | undefined>) => {
    const token = bearerToken(headers);
    if (!token) return null;
    const identity = await verifier.verify(token);
    return identity ? users.signIn(identity) : null;
  };
}

/** Tries each authenticator in order; the first that recognises the request wins. */
export const chainAuthenticators = (...list: Authenticator[]): Authenticator => async (headers) => {
  for (const a of list) {
    const p = await a(headers);
    if (p) return p;
  }
  return null;
};
