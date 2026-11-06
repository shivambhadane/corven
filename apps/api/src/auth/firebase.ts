import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/** Firebase signs ID tokens with rotating Google keys published here. Only the public keys are fetched; nothing secret is involved. */
export const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

export interface FirebaseIdentity {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

export interface FirebaseVerifier {
  /** Returns the identity for a valid Firebase ID token and `null` for anything else. It never throws and never says why. */
  verify(token: string): Promise<FirebaseIdentity | null>;
}

export interface FirebaseVerifierOptions {
  projectId: string;
  /** Key source. Defaults to Google's published keys; tests pass a local key set. */
  keys?: JWTVerifyGetKey;
  now?: () => Date;
}

/**
 * Verifies Firebase ID tokens per Firebase's documented rules: RS256 only (the header `alg` is checked, never trusted to
 * choose the algorithm), issuer `https://securetoken.google.com/<project>`, audience `<project>`, not expired, and a
 * non-empty `sub`. A token without an email is rejected because organization access is keyed on a verified email.
 */
export function createFirebaseVerifier(opts: FirebaseVerifierOptions): FirebaseVerifier {
  const keys = opts.keys ?? createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
  return {
    async verify(token) {
      if (!token || token.length > 8192) return null;
      try {
        const { payload } = await jwtVerify(token, keys, {
          algorithms: ["RS256"],
          issuer: `https://securetoken.google.com/${opts.projectId}`,
          audience: opts.projectId,
          ...(opts.now ? { currentDate: opts.now() } : {}),
        });
        const uid = payload.sub;
        const email = typeof payload["email"] === "string" ? payload["email"].trim() : "";
        if (!uid || uid.length > 128 || !email || email.length > 255) return null;
        // Firebase also guarantees auth_time is in the past; reject a token claiming to have been authenticated in the future.
        const now = Math.floor((opts.now?.() ?? new Date()).getTime() / 1000);
        if (typeof payload["auth_time"] === "number" && payload["auth_time"] > now + 60) return null;
        return { uid, email, emailVerified: payload["email_verified"] === true, name: typeof payload["name"] === "string" ? payload["name"].slice(0, 200) : null };
      } catch {
        return null;
      }
    },
  };
}
