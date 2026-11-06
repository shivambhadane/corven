import { describe, expect, it } from "vitest";
import { analyzeBlastRadius } from "../src/modules/blast-radius/core/analyze.js";
import { buildGraph } from "../src/modules/graph-engine/core/builder.js";
import { ORG, a, r, spec } from "./graph-fixtures.js";

const G = (names: string[], deps: Parameters<typeof spec>[1]) => buildGraph(ORG, spec(names, deps)).graph;
const cls = (res: ReturnType<typeof analyzeBlastRadius>, id: string) => res.impacted.find((n) => n.nodeId === id)?.classification ?? "healthy";

/** The Acme demo: support -authority-> payment; payment -> wallet, customerApi (resource), -> analytics (operational) -> email; support and database also use customerApi. */
const acme = () =>
  G(["support", "payment", "analytics", "email", "database", "R:wallet", "R:customerApi"], [
    ["support", "payment", "authority"],
    ["payment", "R:wallet", "resource"],
    ["payment", "R:customerApi", "resource"],
    ["payment", "analytics", "operational"],
    ["analytics", "email", "operational"],
    ["support", "R:customerApi", "resource"],
    ["database", "R:customerApi", "resource"],
  ]);

describe("blast radius: classification", () => {
  it("classifies the Acme incident", () => {
    const res = analyzeBlastRadius(acme(), [a("payment")]);
    expect(cls(res, a("payment"))).toBe("compromised");
    expect(cls(res, r("wallet"))).toBe("exposed");
    expect(cls(res, r("customerApi"))).toBe("exposed");
    expect(cls(res, a("analytics"))).toBe("potentially_affected");
    expect(cls(res, a("email"))).toBe("potentially_affected");
    expect(cls(res, a("support"))).toBe("uncertain"); // delegator: inherited authority is not modelled
    expect(cls(res, a("database"))).toBe("healthy");
    expect(res.summary).toEqual({ compromised: 1, exposed: 2, potentially_affected: 2, uncertain: 1, healthy: 1 });
  });

  it("keeps authority, resource and operational exposure distinct", () => {
    const res = analyzeBlastRadius(acme(), [a("payment")]);
    const kinds = (id: string) => res.impacted.find((n) => n.nodeId === id)!.exposureKinds;
    expect(kinds(r("wallet"))).toEqual(["resource"]);
    expect(kinds(a("analytics"))).toEqual(["operational"]);
    expect(kinds(a("support"))).toEqual(["authority"]);
  });

  it("explains each classification with a path", () => {
    const res = analyzeBlastRadius(acme(), [a("payment")]);
    const email = res.impacted.find((n) => n.nodeId === a("email"))!;
    expect(email.path!.nodeIds).toEqual([a("payment"), a("analytics"), a("email")]);
    expect(email.path!.edgeIds).toHaveLength(2);
    expect(email.depth).toBe(2);
    expect(res.impacted.find((n) => n.nodeId === a("payment"))!.path).toEqual({ nodeIds: [a("payment")], edgeIds: [], length: 0 });
  });

  it("lists the other dependents of an exposed shared resource", () => {
    const res = analyzeBlastRadius(acme(), [a("payment")]);
    const shared = res.sharedResources.find((s) => s.resourceNodeId === r("customerApi"))!;
    expect(shared.dependents.map((d) => [d.nodeId, d.classification]).sort()).toEqual([
      [a("database"), "healthy"], [a("payment"), "compromised"], [a("support"), "uncertain"],
    ].sort());
  });

  it("operational links imply no authority: an affected agent's resources are not exposed", () => {
    const g = G(["c", "downstream", "R:db"], [["c", "downstream", "operational"], ["downstream", "R:db", "resource"]]);
    const res = analyzeBlastRadius(g, [a("c")]);
    expect(cls(res, a("downstream"))).toBe("potentially_affected");
    expect(cls(res, r("db"))).toBe("healthy");
  });

  it("authority delegation propagates exposure onward; exposed agents' operational links give potential impact", () => {
    const g = G(["c", "d1", "d2", "t", "R:x"], [["c", "d1", "authority"], ["d1", "d2", "authority"], ["d2", "R:x", "resource"], ["d2", "t", "operational"]]);
    const res = analyzeBlastRadius(g, [a("c")]);
    expect(["d1", "d2"].map((n) => cls(res, a(n)))).toEqual(["exposed", "exposed"]);
    expect(cls(res, r("x"))).toBe("exposed");
    expect(cls(res, a("t"))).toBe("potentially_affected");
  });

  it("an agent reachable both ways is exposed, not merely affected", () => {
    const g = G(["c", "m", "x"], [["c", "m", "operational"], ["c", "x", "authority"], ["x", "m", "authority"]]);
    expect(cls(analyzeBlastRadius(g, [a("c")]), a("m"))).toBe("exposed");
  });

  it("depths are minimal when exposed and operational routes mix", () => {
    const g = G(["c", "e1", "e2", "t"], [["c", "e1", "authority"], ["e1", "e2", "authority"], ["c", "t", "operational"], ["e2", "t", "operational"]]);
    const res = analyzeBlastRadius(g, [a("c")]);
    expect(res.impacted.find((n) => n.nodeId === a("t"))!.depth).toBe(1);
  });

  it("handles cycles and multiple compromised agents", () => {
    const g = G(["a", "b", "c", "d"], [["a", "b", "operational"], ["b", "a", "operational"], ["c", "d", "authority"]]);
    const res = analyzeBlastRadius(g, [a("a"), a("c")]);
    expect([cls(res, a("a")), cls(res, a("c")), cls(res, a("b")), cls(res, a("d"))]).toEqual(["compromised", "compromised", "potentially_affected", "exposed"]);
  });

  it("an isolated compromised agent affects nothing", () => {
    const res = analyzeBlastRadius(G(["x", "y"], []), [a("x")]);
    expect(res.summary).toMatchObject({ compromised: 1, exposed: 0, potentially_affected: 0, healthy: 1 });
  });
});

describe("blast radius: uncertainty", () => {
  const weak = () => G(["c", "d", "e"], [["c", "d", "authority", { confidence: 0.3 }], ["d", "e", "operational"]]);

  it("edges below the confidence threshold make the targets uncertain, with what they would be", () => {
    const res = analyzeBlastRadius(weak(), [a("c")]);
    const d = res.impacted.find((n) => n.nodeId === a("d"))!;
    expect(d).toMatchObject({ classification: "uncertain", wouldBe: "exposed" });
    expect(res.impacted.find((n) => n.nodeId === a("e"))).toMatchObject({ classification: "uncertain", wouldBe: "potentially_affected" });
    expect(res.uncertainEdgeIds).toHaveLength(1);
  });

  it("the threshold is configurable", () => {
    expect(cls(analyzeBlastRadius(weak(), [a("c")], { confidenceThreshold: 0.2 }), a("d"))).toBe("exposed");
    expect(cls(analyzeBlastRadius(weak(), [a("c")], { confidenceThreshold: 0.9 }), a("d"))).toBe("uncertain");
  });

  it("stale edges are uncertain; unknown freshness is not stale", () => {
    const day = 86_400_000;
    const now = new Date("2026-11-06T00:00:00Z");
    const g = G(["c", "old", "fresh", "unknown"], [
      ["c", "old", "operational", { lastVerifiedAt: new Date(now.getTime() - 30 * day) }],
      ["c", "fresh", "operational", { lastVerifiedAt: new Date(now.getTime() - 1 * day) }],
      ["c", "unknown", "operational"],
    ]);
    const res = analyzeBlastRadius(g, [a("c")], { staleAfterMs: 7 * day, now });
    expect([cls(res, a("old")), cls(res, a("fresh")), cls(res, a("unknown"))]).toEqual(["uncertain", "potentially_affected", "potentially_affected"]);
  });

  it("inactive edges are ignored", () => {
    const g = G(["c", "d"], [["c", "d", "authority", { status: "inactive" }]]);
    expect(cls(analyzeBlastRadius(g, [a("c")]), a("d"))).toBe("healthy");
  });

  it("always states its limitations", () => {
    expect(analyzeBlastRadius(weak(), [a("c")]).limitations.join(" ")).toMatch(/structural.*invisible.*Inherited authority.*policy values/s);
  });
});

describe("blast radius: validation and determinism", () => {
  it("rejects bad input with structured errors", () => {
    const g = acme();
    expect(() => analyzeBlastRadius(g, [])).toThrow(/At least one/);
    expect(() => analyzeBlastRadius(g, ["agent:ghost"])).toThrow(/not found/i);
    expect(() => analyzeBlastRadius(g, [r("wallet")])).toThrow(/must be an agent/);
    expect(() => analyzeBlastRadius(g, [a("payment")], { confidenceThreshold: 2 })).toThrow(/between 0 and 1/);
    expect(() => analyzeBlastRadius(g, [a("payment")], { staleAfterMs: -1 })).toThrow(/positive/);
  });

  it("is deterministic and independent of source order", () => {
    const one = analyzeBlastRadius(acme(), [a("payment"), a("database")]);
    const two = analyzeBlastRadius(acme(), [a("database"), a("payment"), a("payment")]);
    expect(two).toEqual(one);
  });

  it("does not mutate the graph", () => {
    const g = acme();
    const before = JSON.stringify(g.edges());
    analyzeBlastRadius(g, [a("payment")]);
    expect(JSON.stringify(g.edges())).toBe(before);
  });
});
