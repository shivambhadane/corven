import styles from "./landing.module.css";

/** FIG. 01 — every incident fans out into dependency analysis, blast-radius calculation, and plan-bound approval. */
export function VerificationTopology() {
  const checks = [
    { y: 70, label: "Dependency Graph", tag: "IMMUTABLE · DIRECTED" },
    { y: 180, label: "Blast Radius", tag: "REACHABILITY · TARJAN" },
    { y: 290, label: "Human Approval", tag: "CRYPTOGRAPHICALLY BOUND" },
  ];
  return (
    <svg className={styles.topology} viewBox="0 0 1100 360" role="img" aria-labelledby="fig1-title">
      <title id="fig1-title">
        An incident report fans out into dependency analysis, blast-radius calculation, and plan-bound approval,
        converging into minimum safe containment verified on chain.
      </title>
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1={i * 92 + 46} y1="0" x2={i * 92 + 46} y2="340" className={styles.gridLine} />
      ))}
      {checks.map((c) => (
        <g key={c.label}>
          <path d={`M210 180 C 250 180, 250 ${c.y}, 300 ${c.y} L 380 ${c.y}`} className={styles.wire} />
          <path d={`M600 ${c.y} L 650 ${c.y} C 700 ${c.y}, 700 180, 740 180`} className={styles.wireFade} />
        </g>
      ))}
      <line x1="740" y1="180" x2="790" y2="180" className={styles.wire} />
      <line x1="950" y1="180" x2="975" y2="180" className={styles.wireFade} />
      <rect x="205" y="175" width="10" height="10" transform="rotate(45 210 180)" className={styles.joint} />
      <rect x="735" y="175" width="10" height="10" transform="rotate(45 740 180)" className={styles.joint} />

      <g>
        <rect x="40" y="156" width="170" height="48" rx="6" className={styles.node} />
        <rect x="58" y="172" width="16" height="16" className={styles.nodeMark} />
        <rect x="68" y="172" width="6" height="6" fill="#fff" />
        <text x="84" y="185" className={styles.nodeText}>Incident</text>
        <text x="120" y="185" className={styles.nodeTag}>BREACH DETECTED</text>
      </g>
      {checks.map((c) => (
        <g key={c.label}>
          <rect x="380" y={c.y - 24} width="220" height="48" rx="6" className={styles.node} />
          <text x="398" y={c.y + 6} className={styles.nodeText}>{c.label}</text>
          <text x="398" y={c.y + 18} className={styles.nodeTag}>{c.tag}</text>
        </g>
      ))}
      <g>
        <rect x="790" y="152" width="160" height="56" rx="28" className={styles.nodeHot} />
        <text x="870" y="180" textAnchor="middle" className={styles.nodeHotText}>Minimum safe cut</text>
        <text x="870" y="196" textAnchor="middle" className={styles.nodeHotTag}>ZERO COLLATERAL DAMAGE</text>
      </g>
      <g>
        <rect x="975" y="156" width="110" height="48" rx="6" className={styles.node} />
        <text x="1030" y="183" textAnchor="middle" className={styles.nodeText}>Proof</text>
        <text x="1030" y="196" textAnchor="middle" className={styles.nodeTagRed}>ARKIV · ETHEREUM</text>
      </g>
      <text x="290" y="352" className={styles.figLabel}>FAN-OUT</text>
      <text x="660" y="352" className={styles.figLabel}>CONVERGE</text>
    </svg>
  );
}

/** FIG. 02 — what CORVEN does, incident after incident. */
export function AgentLoop() {
  const steps = [
    ["Discover", "TOPOLOGY · DEPENDENCIES"],
    ["Traverse", "BLAST RADIUS GRAPH"],
    ["Plan", "MINIMUM SAFE CUT"],
    ["Approve", "PLAN-BOUND SIGNATURE"],
    ["Enforce", "GATEWAY · ON-CHAIN SEAL"],
  ];
  return (
    <div className={styles.loop}>
      <ol className={styles.loopSteps}>
        {steps.map(([name, note], i) => (
          <li key={name}>
            <span className={styles.loopIndex}>{String(i + 1).padStart(2, "0")}</span>
            <span className={styles.loopBox}>{name}</span>
            <span className={styles.loopNote}>{note}</span>
          </li>
        ))}
      </ol>
      <div className={styles.loopReturn} aria-hidden="true">
        <span>RESOLVED</span>
      </div>
    </div>
  );
}

/** The pixel ring above "Built for…" in the design. */
export function PixelRing() {
  const cells = Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * Math.PI * 2;
    return { x: 20 + Math.cos(angle) * 14, y: 20 + Math.sin(angle) * 14, on: i % 3 !== 1 };
  });
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      {cells.map((c, i) => (
        <rect key={i} x={c.x - 2.5} y={c.y - 2.5} width="5" height="5" fill="#e8231b" opacity={c.on ? 1 : 0.35} />
      ))}
    </svg>
  );
}

/** The globe-and-star mark on the hero band. */
export function GlobeMark() {
  return (
    <svg className={styles.globeMark} viewBox="0 0 120 120" aria-hidden="true">
      <ellipse cx="60" cy="60" rx="56" ry="38" fill="none" stroke="#fff" strokeWidth="5" />
      <ellipse cx="60" cy="60" rx="30" ry="38" fill="none" stroke="#fff" strokeWidth="4" />
      <line x1="4" y1="60" x2="116" y2="60" stroke="#fff" strokeWidth="4" />
      <path d="M60 12 L68 52 L104 60 L68 68 L60 108 L52 68 L16 60 L52 52 Z" fill="#fff" stroke="#e8231b" strokeWidth="2" />
    </svg>
  );
}

/** Red pixel blocks at the bottom-left of the footer card. */
export function PixelBlocks() {
  const rows = ["   ██", "  █ ██", " ██ █ █", "█ ██ ███ █  ██", "██████████████████"];
  return (
    <svg className={styles.pixelBlocks} viewBox="0 0 180 50" aria-hidden="true">
      {rows.flatMap((row, y) =>
        [...row].map((ch, x) => (ch === "█" ? <rect key={`${x}-${y}`} x={x * 10} y={y * 10} width="10" height="10" fill="#e8231b" /> : null)),
      )}
    </svg>
  );
}
