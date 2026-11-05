// Interactive example: four stages of the same illustrative incident.
// No data leaves the page; this is a static illustration, not CORVEN output.
(() => {
  const svg = document.querySelector(".graph");
  const caption = document.getElementById("demo-caption");
  const panel = document.getElementById("demo-panel");
  const tabs = [...document.querySelectorAll(".demo__tabs [role=tab]")];
  if (!svg || !caption || !panel || tabs.length === 0) return;

  const STAGES = {
    network: {
      text: "Support delegates payment work to Payment. Payment accesses the Wallet and the shared Customer API and triggers Analytics, which triggers Email. Support and Database also use the Customer API.",
      nodes: {}, edges: {}, badges: [],
    },
    blast: {
      text: "Payment is compromised. Following its dependencies exposes the Wallet, the shared Customer API and, through operational links, Analytics and Email. Support and Database are not downstream of Payment, but they share the Customer API with it.",
      nodes: { payment: "is-bad", wallet: "is-risk", api: "is-risk", analytics: "is-risk", email: "is-risk" },
      edges: { e2: "is-risk", e3: "is-risk", e4: "is-risk", e5: "is-risk" },
      badges: ["payment", "wallet", "api", "analytics", "email"],
    },
    naive: {
      text: "Disable Payment and revoke the Customer API for everyone. The attacker is stopped, but Support and Database lose an API they were using legitimately. A wider incident has been created.",
      nodes: { payment: "is-bad", api: "is-bad", support: "is-bad", database: "is-bad" },
      edges: { e1: "is-cut", e2: "is-cut", e4: "is-cut", e5: "is-cut", e6: "is-cut", e7: "is-cut" },
      badges: ["payment", "support", "database"],
    },
    minimal: {
      text: "Cut only Payment's own grants: its Wallet access, its Customer API access and its trigger to Analytics. Support's and Database's access to the shared API is preserved. Revoking Support's delegation to Payment is uncertain, so it waits for a human decision.",
      nodes: { payment: "is-bad", support: "is-ok", database: "is-ok" },
      edges: { e2: "is-cut", e4: "is-cut", e5: "is-cut", e6: "is-keep", e7: "is-keep", e1: "is-appr" },
      badges: ["payment", "support-ok", "database-ok"],
    },
  };

  const NODE_CLASSES = ["is-bad", "is-risk", "is-ok"];
  const EDGE_CLASSES = ["is-risk", "is-cut", "is-keep", "is-appr"];

  function show(name) {
    const stage = STAGES[name];
    if (!stage) return;
    svg.dataset.state = name;
    svg.querySelectorAll(".node").forEach((n) => {
      n.classList.remove(...NODE_CLASSES);
      const c = stage.nodes[n.dataset.id];
      if (c) n.classList.add(c);
    });
    svg.querySelectorAll(".edge").forEach((e) => {
      e.classList.remove(...EDGE_CLASSES);
      const c = stage.edges[e.dataset.id];
      if (c) e.classList.add(c);
    });
    svg.querySelectorAll(".badge").forEach((b) => b.classList.toggle("on", stage.badges.includes(b.dataset.for)));
    caption.textContent = stage.text;
    tabs.forEach((t) => {
      const on = t.dataset.state === name;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      if (on) panel.setAttribute("aria-labelledby", t.id);
    });
  }

  tabs.forEach((t, i) => {
    t.addEventListener("click", () => show(t.dataset.state));
    t.addEventListener("keydown", (ev) => {
      const step = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
      if (!step && ev.key !== "Home" && ev.key !== "End") return;
      ev.preventDefault();
      const next = ev.key === "Home" ? 0 : ev.key === "End" ? tabs.length - 1 : (i + step + tabs.length) % tabs.length;
      tabs[next].focus();
      show(tabs[next].dataset.state);
    });
  });

  // ?stage=blast|naive|minimal opens that stage directly (also handy for sharing or testing).
  const wanted = new URLSearchParams(location.search).get("stage");
  show(wanted && STAGES[wanted] ? wanted : "network");
})();
