"use client";

import Link from "next/link";
import { UserNav } from "./UserNav";

export function Header() {
  return (
    <header className="header">
      <div className="header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          CORVEN
        </Link>
        <nav className="header-nav" aria-label="Main">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/#how">Containment</Link>
          <Link href="/#platform">Architecture</Link>
        </nav>
        <UserNav />
      </div>
    </header>
  );
}
