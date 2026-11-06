"use client";

import Link from "next/link";
import { WalletPanel } from "./WalletPanel";

export function Header() {
  return (
    <header className="header">
      <div className="header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Agent Marketplace
        </Link>
        <nav className="header-nav" aria-label="Main">
          <Link href="/marketplace">Jobs</Link>
          <Link href="/#how">How it works</Link>
        </nav>
        <WalletPanel />
      </div>
    </header>
  );
}
