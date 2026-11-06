"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

export function UserNav() {
  const { user, corvenUser, activeOrg, isDevAuth, isDemo, signOut, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--muted)" }}>
        <span style={{ fontFamily: "var(--mono)" }}>…</span>
      </div>
    );
  }

  if (user || isDevAuth || isDemo) {
    const role = activeOrg?.role || (isDevAuth ? "admin" : isDemo ? "operator" : "member");
    const orgName = activeOrg?.name || "Enterprise Workspace";
    const userLabel = user?.displayName || user?.email || corvenUser?.displayName || corvenUser?.email || "Operator";

    return (
      <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "12.5px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.25 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 600, color: "var(--ink)" }}>
            <span>{orgName}</span>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: "10px",
                textTransform: "uppercase",
                background: "var(--paper)",
                border: "1px solid var(--line)",
                padding: "2px 5px",
                borderRadius: "2px",
                color: "var(--red)",
                fontWeight: 600,
              }}
            >
              {role}
            </span>
          </div>
          <span style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "var(--mono)" }}>
            {userLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          style={{
            background: "transparent",
            border: "1px solid var(--line)",
            padding: "5px 10px",
            borderRadius: "2px",
            fontFamily: "var(--mono)",
            fontSize: "11px",
            textTransform: "uppercase",
            color: "var(--muted)",
            cursor: "pointer",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--red)";
            e.currentTarget.style.borderColor = "var(--red)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--muted)";
            e.currentTarget.style.borderColor = "var(--line)";
          }}
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <Link
        href="/login"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          background: "var(--ink)",
          color: "#ffffff",
          padding: "7px 14px",
          borderRadius: "2px",
          fontFamily: "var(--mono)",
          fontSize: "11.5px",
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          textDecoration: "none",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--red)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--ink)")}
      >
        Sign In &rarr;
      </Link>
    </div>
  );
}
