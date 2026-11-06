import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  signOut as fbSignOut,
  type Auth,
  type User,
} from "firebase/auth";

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export interface PublicAuthConfig {
  devAuth: boolean;
  firebase: FirebaseClientConfig | null;
}

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;

export async function fetchAuthConfig(): Promise<PublicAuthConfig> {
  const res = await fetch("/api/v1/auth/config", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch auth configuration (${res.status})`);
  }
  const body = (await res.json()) as { data: PublicAuthConfig };
  return body.data;
}

export function initFirebase(config: FirebaseClientConfig): { app: FirebaseApp; auth: Auth } {
  if (!appInstance) {
    const existing = getApps();
    appInstance = existing.length > 0 ? existing[0] : initializeApp(config);
  }
  if (!authInstance) {
    authInstance = getAuth(appInstance);
  }
  return { app: appInstance, auth: authInstance };
}

export async function signInWithGoogle(auth: Auth) {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return await signInWithPopup(auth, provider);
}

export async function signInWithEmail(auth: Auth, email: string, pass: string) {
  return await signInWithEmailAndPassword(auth, email.trim(), pass);
}

export async function registerWithEmail(auth: Auth, name: string, email: string, pass: string) {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass);
  if (cred.user && name.trim()) {
    await updateProfile(cred.user, { displayName: name.trim() });
  }
  try {
    if (cred.user) {
      await sendEmailVerification(cred.user);
    }
  } catch {
    // Non-blocking: verification email may fail if not fully enabled in Firebase Console yet
  }
  return cred;
}

export async function signOutFirebase(auth: Auth) {
  await fbSignOut(auth);
}

export type { User, Auth };
