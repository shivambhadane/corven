"use client";

import { useState } from "react";
import styles from "./landing.module.css";

const ITEMS = [
  { name: "Discovery", note: "Continuous mapping of agents, resources & delegated authority." },
  { name: "Graph Engine", note: "Deterministic blast-radius traversal & cycle detection." },
  { name: "Containment", note: "Calculates the minimum safe cut boundary." },
  { name: "Gateway", note: "Authorization enforcement proxy with dynamic access revocation." },
  { name: "Approvals", note: "Cryptographically bound human authorization before enforcement." },
  { name: "Evidence", note: "Tamper-evident incident proofs sealed on Arkiv & Ethereum." },
];

/** The design's big stacked list: one item lit (with the red rule), the rest dimmed; hover or focus lights another. */
export function PlatformList() {
  const [active, setActive] = useState(1);
  return (
    <ol className={styles.platformList}>
      {ITEMS.map((item, i) => (
        <li
          key={item.name}
          className={i === active ? styles.platformActive : undefined}
          onMouseEnter={() => setActive(i)}
          onFocus={() => setActive(i)}
          tabIndex={0}
        >
          <span className={styles.platformIndex}>{String(i + 1).padStart(2, "0")}</span>
          <span className={styles.platformName}>{item.name}</span>
          <span className={styles.platformNote}>{item.note}</span>
        </li>
      ))}
    </ol>
  );
}
