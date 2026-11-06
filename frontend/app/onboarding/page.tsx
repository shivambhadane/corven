"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { corvenApi } from "@/lib/api-client";
import { UserNav } from "@/components/UserNav";
import styles from "./onboarding.module.css";

function Arrow() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M3 1 L7 5 L3 9" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const {
    user,
    idToken,
    corvenUser,
    memberships,
    invitations,
    devSession,
    isDevAuth,
    isDemo,
    loading,
    refreshMe,
  } = useAuth();

  const [orgName, setOrgName] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If not authenticated and not loading, redirect to login
  useEffect(() => {
    if (!loading && !user && !isDevAuth && !isDemo) {
      router.push("/login");
    }
  }, [loading, user, isDevAuth, isDemo, router]);

  const handleAccept = async (invitationId: string) => {
    setError(null);
    setSubmitting(true);
    try {
      await corvenApi.acceptInvitation(idToken || "", invitationId, devSession);
      await refreshMe();
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept invitation");
      setSubmitting(false);
    }
  };

  const handleDecline = async (invitationId: string) => {
    setError(null);
    setSubmitting(true);
    try {
      await corvenApi.declineInvitation(idToken || "", invitationId, devSession);
      await refreshMe();
      setSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to decline invitation");
      setSubmitting(false);
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!orgName.trim() || orgName.trim().length < 2) {
      setError("Organization name must be at least 2 characters.");
      return;
    }

    setSubmitting(true);
    try {
      await corvenApi.createOrganization(
        idToken || "",
        {
          name: orgName.trim(),
          website: website.trim() ? website.trim() : undefined,
        },
        devSession,
      );
      await refreshMe();
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organization");
      setSubmitting(false);
    }
  };

  const handleCheckVerification = async () => {
    if (user) {
      await user.reload();
      await refreshMe();
    }
  };

  if (loading) {
    return (
      <div className={styles.onboardingPage}>
        <div className={styles.topRule} aria-hidden="true" />
        <header className={styles.nav}>
          <Link href="/" className={styles.logo}>
            <span className={styles.logoMark} aria-hidden="true" />
            CORVEN
          </Link>
        </header>
        <main className={styles.main}>
          <div style={{ fontFamily: "var(--mono)", fontSize: "13px", color: "var(--muted)" }}>
            Loading workspace state…
          </div>
        </main>
      </div>
    );
  }

  const isVerified = corvenUser?.emailVerified ?? (user?.emailVerified || isDevAuth || isDemo);
  const displayEmail = user?.email || corvenUser?.email || "operator@enterprise.internal";

  return (
    <div className={styles.onboardingPage}>
      <div className={styles.topRule} aria-hidden="true" />

      <header className={styles.nav}>
        <Link href="/" className={styles.logo}>
          <span className={styles.logoMark} aria-hidden="true" />
          CORVEN
        </Link>
        <UserNav />
      </header>

      <main className={styles.main}>
        <div className={styles.card}>
          <div className={styles.eyebrow}>Workspace Onboarding</div>
          <h1 className={styles.title}>Set Up Your Security Workspace</h1>
          <p className={styles.desc}>
            CORVEN is a multi-tenant platform. All autonomous agent topologies, containment policies, and cryptographic proofs belong to an organization workspace.
          </p>

          <div className={styles.userSummary}>
            <span className={styles.userSummaryEmail}>{displayEmail}</span>
            <span
              className={`${styles.userSummaryStatus} ${
                isVerified ? styles.statusVerified : styles.statusUnverified
              }`}
            >
              {isVerified ? "Verified Email" : "Unverified"}
            </span>
          </div>

          {!isVerified && (
            <div className={styles.alertWarn}>
              <div>
                <strong>Verification required:</strong> Please verify your work email address to create or administer workspaces. A verification link was sent to your inbox.
              </div>
              <div>
                <button
                  type="button"
                  className={styles.btnSmallGhost}
                  onClick={handleCheckVerification}
                >
                  I verified my email &rarr; Refresh Status
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className={styles.alertError} role="alert">
              <strong>Error:</strong> {error}
            </div>
          )}

          {invitations.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Pending Workspace Invitations</div>
              {invitations.map((inv) => (
                <div key={inv.id} className={styles.invitationItem}>
                  <div className={styles.invitationInfo}>
                    <span className={styles.invitationOrg}>{inv.organizationName}</span>
                    <span className={styles.invitationRole}>Role: {inv.role}</span>
                  </div>
                  <div className={styles.invitationActions}>
                    <button
                      type="button"
                      className={styles.btnSmallPrimary}
                      onClick={() => handleAccept(inv.id)}
                      disabled={submitting || !isVerified}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className={styles.btnSmallGhost}
                      onClick={() => handleDecline(inv.id)}
                      disabled={submitting || !isVerified}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {memberships.length > 0 && (
            <div className={styles.section} style={{ background: "var(--paper)" }}>
              <div className={styles.sectionTitle}>Existing Workspaces</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
                {memberships.map((m) => (
                  <div key={m.organizationId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600 }}>{m.name}</span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: "11px", color: "var(--red)" }}>
                      {m.role.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
              <Link
                href="/dashboard"
                className={styles.btnRed}
                style={{ textAlign: "center", textDecoration: "none" }}
              >
                Go to Active Workspace &rarr;
              </Link>
            </div>
          )}

          <form onSubmit={handleCreateOrg} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="orgName">
                Organization / Workspace Name
              </label>
              <input
                id="orgName"
                type="text"
                className={styles.input}
                placeholder="e.g. Acme CyberSecurity Corp"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                minLength={2}
                maxLength={80}
                required
                disabled={!isVerified}
              />
              <span className={styles.fieldHelp}>
                Self-serve signups start on the Starter tier (governance &amp; containment for autonomous agents).
              </span>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="website">
                Company Website (Optional)
              </label>
              <input
                id="website"
                type="url"
                className={styles.input}
                placeholder="https://acme-corp.com"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                disabled={!isVerified}
              />
            </div>

            <button
              type="submit"
              className={styles.btnRed}
              disabled={submitting || !isVerified || !orgName.trim()}
            >
              {submitting ? "Provisioning Workspace…" : "Create Security Workspace"} <Arrow />
            </button>
          </form>

          <div className={styles.securityNote}>
            <span style={{ color: "var(--red)" }}>●</span> Dedicated Multi-Tenant Data Isolation
          </div>
        </div>
      </main>
    </div>
  );
}
