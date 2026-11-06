import { describe, expect, it } from "vitest";
import { buildGraph, checkIntegrity } from "../src/modules/graph-engine/core/builder.js";
import { exportGraph } from "../src/modules/graph-engine/core/export.js";
import { Graph } from "../src/modules/graph-engine/core/graph.js";
import { GraphError } from "../src/modules/graph-engine/errors.js";
import { LIMITS } from "../src/modules/graph-engine/types/graph.types.js";
import { ORG, a, build, r, spec } from "./graph-fixtures.js";

describe("graph construction", () => {
  it("represents agents and resources as nodes and dependencies as directed edges", () => {
    const g = build(["support", "payment", "R:wallet"], [["support", "payment", "authority"], ["payment", "R:wallet", "resource"]]);
    expect(g.metadata).toMatchObject({ nodeCount: 3, edgeCount: 2 });
    expect(g.getNode(a("support"))).toMatchObject({ entityType: "agent", entityId: "support", status: "active" });
    expect(g.getNode(r("wallet"))).toMatchObject({ entityType: "resource", status: null });
    const e = g.outgoingEdges(a("support"))[0]!;
    expect(e).toMatchObject({ sourceNodeId: a("support"), targetNodeId: a("payment"), dependencyType: "authority", confidence: 0.9, provenance: { source: "manual" } });
    expect(g.incomingEdges(a("support"))).toHaveLength(0); // direction is not assumed to be symmetric
  });

  it("looks nodes up by id and by entity identity", () => {
    const g = build(["x", "R:y"], []);
    expect(g.getNodeByEntity("agent", "x")?.id).toBe(a("x"));
    expect(g.getNodeByEntity("resource", "y")?.id).toBe(r("y"));
    expect(g.getNodeByEntity("agent", "y")).toBeUndefined();
    expect(g.getNode("agent:nope")).toBeUndefined();
  });

  it("an agent and a resource with the same raw id are different nodes", () => {
    const g = build(["same", "R:same"], [["same", "R:same", "resource"]]);
    expect(g.metadata.nodeCount).toBe(2);
    expect(g.hasNode(a("same"))).toBe(true);
    expect(g.hasNode(r("same"))).toBe(true);
  });

  it("represents a shared resource once, with every dependent pointing at it", () => {
    const g = build(["s", "d", "n", "R:customer-api"], [["s", "R:customer-api", "resource"], ["d", "R:customer-api", "resource"], ["n", "R:customer-api", "resource"]]);
    expect(g.nodes().filter((x) => x.entityType === "resource")).toHaveLength(1);
    expect(g.incomingEdges(r("customer-api")).map((e) => e.sourceNodeId)).toEqual([a("d"), a("n"), a("s")]);
  });

  it("handles the empty graph and isolated nodes", () => {
    expect(build([], []).metadata).toMatchObject({ nodeCount: 0, edgeCount: 0 });
    const g = build(["lonely"], []);
    expect(g.outgoingEdges(a("lonely"))).toEqual([]);
    expect(g.incomingEdges(a("lonely"))).toEqual([]);
  });

  it("keeps parallel edges of different types between the same pair distinct", () => {
    const g = build(["p", "q"], [["p", "q", "authority"], ["p", "q", "operational"]]);
    expect(g.outgoingEdges(a("p"))).toHaveLength(2);
    expect(new Set(g.outgoingEdges(a("p")).map((e) => e.dependencyType))).toEqual(new Set(["authority", "operational"]));
  });

  it("is deterministic regardless of input order", () => {
    const names = ["c", "a", "b", "R:z"];
    const deps: Parameters<typeof spec>[1] = [["a", "b"], ["b", "c"], ["a", "R:z", "resource"], ["c", "a"]];
    const one = exportGraph(buildGraph(ORG, spec(names, deps), { builtAt: new Date(0) }).graph);
    const input = spec([...names].reverse(), deps);
    input.dependencies = [...input.dependencies].reverse();
    const two = exportGraph(buildGraph(ORG, input, { builtAt: new Date(0) }).graph);
    expect(two).toEqual(one);
  });
});

describe("graph integrity (invalid input is reported, never silently included)", () => {
  const report = (names: string[], deps: Parameters<typeof spec>[1], mutate?: (i: ReturnType<typeof spec>) => void) => {
    const input = spec(names, deps);
    mutate?.(input);
    return buildGraph(ORG, input);
  };

  it("rejects duplicate nodes", () => {
    const { graph, report: rep } = report(["x"], [], (i) => i.agents = [...i.agents, ...i.agents]);
    expect(graph.metadata.nodeCount).toBe(1);
    expect(rep.issues).toMatchObject([{ kind: "node", code: "DUPLICATE_NODE", recordId: "x" }]);
  });

  it("rejects duplicate edges", () => {
    const { graph, report: rep } = report(["x", "y"], [["x", "y"]], (i) => i.dependencies = [...i.dependencies, ...i.dependencies]);
    expect(graph.metadata.edgeCount).toBe(1);
    expect(rep.issues[0]).toMatchObject({ code: "DUPLICATE_EDGE" });
  });

  it("rejects an edge whose source or target is missing", () => {
    const { graph, report: rep } = report(["x"], [["x", "ghost"], ["ghost2", "x"]]);
    expect(graph.metadata.edgeCount).toBe(0);
    expect(rep.invalidEdgeCount).toBe(2);
    expect(rep.issues.every((i) => i.code === "DANGLING_EDGE")).toBe(true);
  });

  it("never includes records from another organization", () => {
    const { graph, report: rep } = report(["x", "y"], [["x", "y"]], (i) => {
      i.agents.push({ id: "alien", organizationId: "org-2", name: "alien", status: "active", agentType: "llm", externalReference: null });
      i.dependencies.push({ ...i.dependencies[0]!, id: "dep-alien", organizationId: "org-2" });
    });
    expect(graph.hasNode(a("alien"))).toBe(false);
    expect(graph.getEdge("dep-alien")).toBeUndefined();
    expect(rep.issues.map((i) => i.code).sort()).toEqual(["CROSS_TENANT_REFERENCE", "CROSS_TENANT_REFERENCE"]);
    expect(graph.nodes().every((n) => n.organizationId === ORG)).toBe(true);
  });

  it("an edge in this organization pointing at another organization's node is dangling", () => {
    const input = spec(["x"], []);
    input.dependencies.push({ ...spec(["x", "alien"], [["x", "alien"]]).dependencies[0]! });
    const { graph, report: rep } = buildGraph(ORG, input);
    expect(graph.metadata.edgeCount).toBe(0);
    expect(rep.issues[0]).toMatchObject({ code: "DANGLING_EDGE" });
  });

  it.each([
    ["dependency type", { dependencyType: "friendship" }, "INVALID_DEPENDENCY_TYPE"],
    ["status", { status: "deleted" }, "INVALID_STATUS"],
    ["confidence above 1", { confidence: 1.2 }, "INVALID_CONFIDENCE"],
    ["confidence NaN", { confidence: Number.NaN }, "INVALID_CONFIDENCE"],
    ["endpoint type", { sourceType: "workflow" }, "INVALID_ENDPOINT_TYPE"],
  ])("rejects an invalid %s", (_l, over, code) => {
    const { graph, report: rep } = report(["x", "y"], [["x", "y", "operational", over]]);
    expect(graph.metadata.edgeCount).toBe(0);
    expect(rep.issues[0]).toMatchObject({ kind: "edge", code });
  });

  it("issues carry ids and reasons only, never record contents", () => {
    const { report: rep } = report(["x", "y"], [["x", "y", "operational", { dependencyType: "bad", metadata: { secret: "s3cr3t" }, relationship: "private-label" }]]);
    expect(JSON.stringify(rep)).not.toMatch(/s3cr3t|private-label/);
  });

  it("strict mode throws INVALID_GRAPH instead of reporting", () => {
    const input = spec(["x"], [["x", "ghost"]]);
    expect(() => buildGraph(ORG, input, { strict: true })).toThrowError(GraphError);
    try {
      buildGraph(ORG, input, { strict: true });
    } catch (e) {
      expect((e as GraphError).code).toBe("INVALID_GRAPH");
    }
  });

  it("refuses inventories beyond the size limit with GRAPH_BUILD_FAILED", () => {
    const input = spec([], []);
    input.agents = { length: LIMITS.maxNodes + 1 } as never;
    expect(() => buildGraph(ORG, input)).toThrowError(/size limit/);
  });

  it("checkIntegrity finds nothing on a built graph", () => {
    expect(checkIntegrity(build(["x", "y"], [["x", "y"]]))).toEqual([]);
  });

  it("checkIntegrity detects a graph constructed with a dangling edge or foreign node", () => {
    const base = build(["x", "y"], [["x", "y"]]);
    const edge = base.edges()[0]!;
    const broken = new Graph(ORG, [base.getNode(a("x"))!, { ...base.getNode(a("y"))!, organizationId: "org-2" }], [{ ...edge, targetNodeId: "agent:ghost" }]);
    expect(checkIntegrity(broken).sort()).toEqual([`edge ${edge.id} has a missing target`, "node agent:y belongs to another organization"].sort());
  });
});

describe("immutability", () => {
  it("exposes frozen data and cannot be mutated through accessors", () => {
    const g = build(["x", "y"], [["x", "y"]]);
    const node = g.getNode(a("x"))!;
    expect(() => { (node as { name: string }).name = "hacked"; }).toThrow();
    const edge = g.edges()[0]!;
    expect(() => { (edge as { confidence: number }).confidence = 0; }).toThrow();
    expect(() => { (edge.provenance as Record<string, unknown>).source = "x"; }).toThrow();
    expect(() => { (g.nodes() as unknown as unknown[]).push({}); }).toThrow();
    expect(() => { (g.outgoingEdges(a("x")) as unknown as unknown[]).push({}); }).toThrow();
    expect(g.metadata.nodeCount).toBe(2);
    expect(() => { (g.metadata as { nodeCount: number }).nodeCount = 9; }).toThrow();
  });

  it("does not alias the caller's input records", () => {
    const input = spec(["x", "y"], [["x", "y"]]);
    const { graph } = buildGraph(ORG, input);
    input.dependencies[0]!.confidence = 0.01;
    input.agents[0]!.name = "changed";
    expect(graph.edges()[0]!.confidence).toBe(0.9);
    expect(graph.getNode(a("x"))!.name).toBe("x");
  });
});

describe("export", () => {
  it("is plain JSON with ISO dates and honours filters", () => {
    const g = build(["x", "y", "R:z"], [["x", "y"], ["y", "R:z", "resource"], ["x", "R:z", "resource", { status: "inactive" }]]);
    const all = exportGraph(g);
    expect(all.nodes).toHaveLength(3);
    expect(all.edges).toHaveLength(2); // inactive excluded by default
    expect(typeof all.edges[0]!.createdAt).toBe("string");
    expect(JSON.parse(JSON.stringify(all))).toEqual(all);
    expect(exportGraph(g, { edgeStatuses: ["active", "inactive"] }).edges).toHaveLength(3);
    expect(exportGraph(g, { dependencyTypes: ["resource"] }).edges).toHaveLength(1);
  });
});
