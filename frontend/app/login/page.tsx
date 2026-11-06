"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import type { Role } from "@/lib/api-client";
import styles from "./login.module.css";

function Arrow() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M3 1 L7 5 L3 9" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.616z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.347 2.825.957 4.039l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

function formatFirebaseError(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = String((err as { code: unknown }).code);
    switch (code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return "Invalid email or password.";
      case "auth/email-already-in-use":
        return "An account with this email address already exists. Try signing in instead.";
      case "auth/weak-password":
        return "Password is too weak. Please choose at least 8 characters.";
      case "auth/invalid-email":
        return "Please enter a valid work email address.";
      case "auth/popup-closed-by-user":
        return "Google sign-in popup was closed before completing.";
      case "auth/popup-blocked":
        return "Sign-in popup was blocked by your browser. Please allow popups for localhost.";
      default:
        return (err as { message?: string }).message || "Authentication failed.";
    }
  }
  return err instanceof Error ? err.message : "Authentication failed.";
}

export default function LoginPage() {
  const router = useRouter();
  const {
    user,
    corvenUser,
    memberships,
    isDevAuth,
    isDemo,
    authConfig,
    signInGoogle,
    signInEmail,
    registerEmail,
    signInDev,
    signInDemo,
    error: authError,
    clearError,
  } = useAuth();

  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // If already authenticated, redirect to appropriate destination
  useEffect(() => {
    if (user || isDevAuth || isDemo) {
      if (corvenUser && memberships.length === 0) {
        router.push("/onboarding");
      } else {
        router.push("/dashboard");
      }
    }
  }, [user, isDevAuth, isDemo, corvenUser, memberships, router]);

  const handleGoogleSubmit = async () => {
    setLocalError(null);
    clearError();
    setSubmitting(true);
    try {
      await signInGoogle();
      // Navigation is triggered by the auth state observer
    } catch (err) {
      setLocalError(formatFirebaseError(err));
      setSubmitting(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setInfoMessage(null);
    clearError();

    if (!email.trim() || !password) {
      setLocalError("Please provide both email and password.");
      return;
    }

    if (mode === "register" && !name.trim()) {
      setLocalError("Please enter your name for registration.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "signin") {
        await signInEmail(email, password);
      } else {
        await registerEmail(name, email, password);
        setInfoMessage("Enterprise account registered successfully. Verification email sent.");
      }
      // On success, state listener will route to /dashboard or /onboarding
    } catch (err) {
      setLocalError(formatFirebaseError(err));
      setSubmitting(false);
    }
  };

  const handleDevQuickLogin = async (role: Role) => {
    setSubmitting(true);
    try {
      await signInDev(role, "Acme Security Corp");
      router.push("/dashboard");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed dev login");
      setSubmitting(false);
    }
  };

  const handleDemoLaunch = async () => {
    setSubmitting(true);
    try {
      await signInDemo("admin");
      router.push("/dashboard");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to launch demo sandbox");
      setSubmitting(false);
    }
  };

  const displayError = localError || authError;

  return (
    <div className={styles.loginPage}>
      <div className={styles.topRule} aria-hidden="true" />

      <header className={styles.nav}>
        <Link href="/" className={styles.logo}>
          <span className={styles.logoMark} aria-hidden="true" />
          CORVEN
        </Link>
        <Link href="/" className={styles.backLink}>
          ← Back to site
        </Link>
      </header>

      <main className={styles.main}>
        <div className={styles.card}>
          <div className={styles.eyebrow}>Autonomous Incident Governance</div>
          <h1 className={styles.title}>
            {mode === "signin" ? "Sign In to CORVEN" : "Register Organization Account"}
          </h1>
          <p className={styles.desc}>
            {mode === "signin"
              ? "Access your agent dependency topology, live blast-radius containment, and sealed evidence vaults."
              : "Register your identity to administer security policies, contain autonomous agents, and manage enterprise workspaces."}
          </p>

          <div className={styles.tabs} role="tablist">
            <button
              type="button"
              className={`${styles.tab} ${mode === "signin" ? styles.tabActive : ""}`}
              onClick={() => {
                setMode("signin");
                setLocalError(null);
                setInfoMessage(null);
              }}
              role="tab"
              aria-selected={mode === "signin"}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`${styles.tab} ${mode === "register" ? styles.tabActive : ""}`}
              onClick={() => {
                setMode("register");
                setLocalError(null);
                setInfoMessage(null);
              }}
              role="tab"
              aria-selected={mode === "register"}
            >
              Register
            </button>
          </div>

          {displayError && (
            <div className={styles.alertError} role="alert">
              <strong>Error:</strong> {displayError}
            </div>
          )}

          {infoMessage && (
            <div className={styles.alertInfo} role="status">
              {infoMessage}
            </div>
          )}

          <button
            type="button"
            className={styles.googleBtn}
            onClick={handleGoogleSubmit}
            disabled={submitting}
          >
            <GoogleIcon />
            {mode === "signin" ? "Continue with Google" : "Sign up with Google"}
          </button>

          <div className={styles.divider}>
            <span>or use work email</span>
          </div>

          <form onSubmit={handleEmailSubmit} className={styles.form}>
            {mode === "register" && (
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="name">
                  Full Name
                </label>
                <input
                  id="name"
                  type="text"
                  className={styles.input}
                  placeholder="e.g. Alex Vance"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                />
              </div>
            )}

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="email">
                Work Email
              </label>
              <input
                id="email"
                type="email"
                className={styles.input}
                placeholder="name@enterprise.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className={styles.input}
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                minLength={8}
                required
              />
            </div>

            <button type="submit" className={styles.btnRed} disabled={submitting}>
              {submitting
                ? mode === "signin"
                  ? "Authenticating…"
                  : "Creating Account…"
                : mode === "signin"
                ? "Sign in to Console"
                : "Create Account & Proceed"}{" "}
              <Arrow />
            </button>
          </form>

          {authConfig?.devAuth && (
            <div className={styles.devSection}>
              <div className={styles.devHeader}>
                <span className={styles.devTitle}>Local Dev Fast Sign-In</span>
                <span className={styles.devBadge}>Dev Auth Active</span>
              </div>
              <div className={styles.devGrid}>
                <button
                  type="button"
                  className={styles.devBtn}
                  onClick={() => handleDevQuickLogin("admin")}
                  disabled={submitting}
                >
                  <span className={styles.devBtnRole}>Admin</span>
                  <span className={styles.devBtnDesc}>Full governance</span>
                </button>
                <button
                  type="button"
                  className={styles.devBtn}
                  onClick={() => handleDevQuickLogin("operator")}
                  disabled={submitting}
                >
                  <span className={styles.devBtnRole}>Operator</span>
                  <span className={styles.devBtnDesc}>Raise incidents</span>
                </button>
                <button
                  type="button"
                  className={styles.devBtn}
                  onClick={() => handleDevQuickLogin("approver")}
                  disabled={submitting}
                >
                  <span className={styles.devBtnRole}>Approver</span>
                  <span className={styles.devBtnDesc}>Authorize plans</span>
                </button>
                <button
                  type="button"
                  className={styles.devBtn}
                  onClick={() => handleDevQuickLogin("viewer")}
                  disabled={submitting}
                >
                  <span className={styles.devBtnRole}>Viewer</span>
                  <span className={styles.devBtnDesc}>Read-only audit</span>
                </button>
              </div>
            </div>
          )}

          <div className={styles.securityNote}>
            <span style={{ color: "var(--red)" }}>●</span> Verified by Google Cloud Identity &amp; Cryptographic Evidence
          </div>

          <div className={styles.footer}>
            Need to evaluate without an account?{" "}
            <button type="button" onClick={handleDemoLaunch} disabled={submitting}>
              Launch Interactive Sandbox Demo &rarr;
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
