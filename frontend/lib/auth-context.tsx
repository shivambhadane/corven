"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import {
  fetchAuthConfig,
  initFirebase,
  signInWithGoogle as fbSignInWithGoogle,
  signInWithEmail as fbSignInWithEmail,
  registerWithEmail as fbRegisterWithEmail,
  signOutFirebase,
  type Auth,
  type User,
  type PublicAuthConfig,
} from "./firebase";
import {
  corvenApi,
  type CorvenUser,
  type OrganizationMembership,
  type PendingInvitation,
  type DevSession,
  type DemoSession,
  type Role,
  type MeData,
} from "./api-client";
import { onAuthStateChanged } from "firebase/auth";

export interface AuthContextType {
  loading: boolean;
  error: string | null;
  authConfig: PublicAuthConfig | null;
  user: User | null;
  idToken: string | null;
  corvenUser: CorvenUser | null;
  memberships: OrganizationMembership[];
  invitations: PendingInvitation[];
  activeOrg: OrganizationMembership | null;
  devSession: DevSession | null;
  demoSession: DemoSession | null;
  isDevAuth: boolean;
  isDemo: boolean;
  signInGoogle: () => Promise<void>;
  signInEmail: (email: string, pass: string) => Promise<void>;
  registerEmail: (name: string, email: string, pass: string) => Promise<void>;
  signInDev: (role?: Role, orgName?: string) => Promise<void>;
  signInDemo: (persona?: Role) => Promise<void>;
  selectOrg: (orgId: string) => void;
  refreshMe: () => Promise<MeData | null>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const DEV_KEY = "corven.dev_session";
const DEMO_KEY = "corven.demo_session";
const ORG_KEY = "corven.active_org_id";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authConfig, setAuthConfig] = useState<PublicAuthConfig | null>(null);
  const [authInstance, setAuthInstance] = useState<Auth | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [corvenUser, setCorvenUser] = useState<CorvenUser | null>(null);
  const [memberships, setMemberships] = useState<OrganizationMembership[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [activeOrg, setActiveOrg] = useState<OrganizationMembership | null>(null);

  const [devSession, setDevSession] = useState<DevSession | null>(null);
  const [demoSession, setDemoSession] = useState<DemoSession | null>(null);

  const clearError = () => setError(null);

  // Initialize Auth Configuration and Firebase
  useEffect(() => {
    let unmounted = false;
    async function setup() {
      try {
        const config = await fetchAuthConfig();
        if (unmounted) return;
        setAuthConfig(config);

        if (config.firebase) {
          const { auth } = initFirebase(config.firebase);
          setAuthInstance(auth);
        } else {
          // If Firebase is not configured, check for saved dev session
          const savedDev = localStorage.getItem(DEV_KEY);
          if (savedDev && config.devAuth) {
            try {
              const parsed = JSON.parse(savedDev) as DevSession;
              setDevSession(parsed);
              setActiveOrg({
                organizationId: parsed.organizationId,
                name: parsed.organizationName,
                slug: parsed.organizationName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
                role: parsed.role,
                tier: parsed.tier,
              });
            } catch {
              localStorage.removeItem(DEV_KEY);
            }
          }
          setLoading(false);
        }
      } catch (err) {
        if (!unmounted) {
          console.error("Failed to load auth config:", err);
          setError(err instanceof Error ? err.message : "Failed to connect to authentication service");
          setLoading(false);
        }
      }
    }
    void setup();
    return () => {
      unmounted = true;
    };
  }, []);

  const syncMe = useCallback(async (token: string): Promise<MeData | null> => {
    try {
      const data = await corvenApi.getMe(token);
      setCorvenUser(data.user);
      setMemberships(data.memberships);
      setInvitations(data.invitations);

      const savedOrgId = localStorage.getItem(ORG_KEY);
      const chosen = (savedOrgId ? data.memberships.find((m) => m.organizationId === savedOrgId) : null) || data.memberships[0] || null;
      setActiveOrg(chosen);
      if (chosen) {
        localStorage.setItem(ORG_KEY, chosen.organizationId);
      }
      return data;
    } catch (err) {
      console.warn("Error calling /me:", err);
      return null;
    }
  }, []);

  // Listen to Firebase auth state changes
  useEffect(() => {
    if (!authInstance) return;

    const unsubscribe = onAuthStateChanged(authInstance, async (fbUser) => {
      setUser(fbUser);
      if (fbUser) {
        try {
          const token = await fbUser.getIdToken();
          setIdToken(token);
          // Clear dev/demo sessions when a real Firebase user signs in
          setDevSession(null);
          setDemoSession(null);
          localStorage.removeItem(DEV_KEY);
          localStorage.removeItem(DEMO_KEY);
          await syncMe(token);
        } catch (err) {
          console.error("Error syncing user after Firebase auth change:", err);
        }
      } else {
        setIdToken(null);
        setCorvenUser(null);
        setMemberships([]);
        setInvitations([]);
        setActiveOrg(null);
        localStorage.removeItem(ORG_KEY);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [authInstance, syncMe]);

  const selectOrg = useCallback((orgId: string) => {
    const org = memberships.find((m) => m.organizationId === orgId);
    if (org) {
      setActiveOrg(org);
      localStorage.setItem(ORG_KEY, org.organizationId);
    }
  }, [memberships]);

  const refreshMe = useCallback(async () => {
    if (idToken) {
      return await syncMe(idToken);
    }
    return null;
  }, [idToken, syncMe]);

  const signInGoogle = async () => {
    if (!authInstance) throw new Error("Firebase Authentication is not configured");
    setError(null);
    try {
      await fbSignInWithGoogle(authInstance);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to sign in with Google";
      setError(msg);
      throw err;
    }
  };

  const signInEmail = async (email: string, pass: string) => {
    if (!authInstance) throw new Error("Firebase Authentication is not configured");
    setError(null);
    try {
      await fbSignInWithEmail(authInstance, email, pass);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to sign in with email";
      setError(msg);
      throw err;
    }
  };

  const registerEmail = async (name: string, email: string, pass: string) => {
    if (!authInstance) throw new Error("Firebase Authentication is not configured");
    setError(null);
    try {
      await fbRegisterWithEmail(authInstance, name, email, pass);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create account";
      setError(msg);
      throw err;
    }
  };

  const signInDev = async (role: Role = "admin", orgName = "Acme Security Corp") => {
    setError(null);
    const orgId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const session: DevSession = {
      actorId,
      organizationId: orgId,
      organizationName: orgName,
      role,
      tier: "pro",
    };
    setDevSession(session);
    setDemoSession(null);
    localStorage.setItem(DEV_KEY, JSON.stringify(session));
    localStorage.removeItem(DEMO_KEY);

    setActiveOrg({
      organizationId: orgId,
      name: orgName,
      slug: orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      role,
      tier: "pro",
    });
    setCorvenUser({
      id: actorId,
      email: `${role}@${orgName.toLowerCase().replace(/[^a-z0-9]+/g, "")}.internal`,
      emailVerified: true,
      displayName: `Dev ${role.toUpperCase()}`,
    });
  };

  const signInDemo = async (persona: Role = "admin") => {
    setError(null);
    try {
      setLoading(true);
      const res = await corvenApi.startDemoSession();
      const demo: DemoSession = {
        token: res.token,
        organizationId: res.organizationId,
        persona,
        expiresAt: res.expiresAt,
      };
      setDemoSession(demo);
      setDevSession(null);
      localStorage.setItem(DEMO_KEY, JSON.stringify(demo));
      localStorage.removeItem(DEV_KEY);

      setActiveOrg({
        organizationId: res.organizationId,
        name: "Acme Technologies (Sandbox)",
        slug: "acme-sandbox",
        role: persona,
        tier: "pro",
      });
      setCorvenUser({
        id: "demo-actor",
        email: `demo-${persona}@corven.network`,
        emailVerified: true,
        displayName: `Sandbox ${persona.toUpperCase()}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start demo sandbox session";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    setError(null);
    if (authInstance && user) {
      await signOutFirebase(authInstance);
    }
    setDevSession(null);
    setDemoSession(null);
    setUser(null);
    setIdToken(null);
    setCorvenUser(null);
    setMemberships([]);
    setInvitations([]);
    setActiveOrg(null);
    localStorage.removeItem(DEV_KEY);
    localStorage.removeItem(DEMO_KEY);
    localStorage.removeItem(ORG_KEY);
  };

  return (
    <AuthContext.Provider
      value={{
        loading,
        error,
        authConfig,
        user,
        idToken,
        corvenUser,
        memberships,
        invitations,
        activeOrg,
        devSession,
        demoSession,
        isDevAuth: !!devSession,
        isDemo: !!demoSession,
        signInGoogle,
        signInEmail,
        registerEmail,
        signInDev,
        signInDemo,
        selectOrg,
        refreshMe,
        signOut,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
