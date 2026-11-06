import { describe, expect, it } from "vitest";
import { aggregate, incidentOutcomeFor, reachableProtected } from "../src/modules/verification-service/core/outcome.js";
import type { CheckRecord } from "../src/modules/verification-service/types.js";

const c = (purpose: "security" | "continuity", result: CheckRecord["result"]): CheckRecord => ({
  category: purpose === "security" ? "NEGATIVE_ACCESS_TEST" : "POSITIVE_ACCESS_TEST", purpose, agentId: null, resourceId: null, action: null, expected: "deny", actual: "", result, detail: {}, executionReference: null, limitation: null,
});

describe("aggregating checks", () => {
  it("passes only when every check passed", () => {
    expect(aggregate([c("security", "passed"), c("continuity", "passed")]).status).toBe("passed");
  });
  it("fails when nothing that produced a security result is blocked", () => {
    expect(aggregate([c("security", "failed"), c("security", "failed"), c("continuity", "passed")]).status).toBe("failed");
    expect(aggregate([c("security", "failed"), c("security", "inconclusive")]).status).toBe("failed");
    // a passing bypass-resistance declaration does not mean anything was blocked
    expect(aggregate([c("security", "failed"), { ...c("security", "passed"), category: "BYPASS_RESISTANCE_TEST" }]).status).toBe("failed");
  });
  it("is partial for anything in between, including broken healthy paths and inconclusive checks", () => {
    expect(aggregate([c("security", "passed"), c("security", "failed")]).status).toBe("partially_verified");
    expect(aggregate([c("security", "passed"), c("continuity", "failed")]).status).toBe("partially_verified");
    expect(aggregate([c("security", "passed"), c("security", "inconclusive")]).status).toBe("partially_verified");
    expect(aggregate([c("security", "passed"), c("continuity", "inconclusive")]).status).toBe("partially_verified");
  });
  it("is inconclusive when nothing was observed or no security check exists", () => {
    expect(aggregate([]).status).toBe("inconclusive");
    expect(aggregate([c("security", "inconclusive"), c("continuity", "inconclusive")]).status).toBe("inconclusive");
    expect(aggregate([c("continuity", "passed")]).status).toBe("inconclusive");
  });
  it("counts results", () => {
    expect(aggregate([c("security", "passed"), c("security", "failed"), c("continuity", "failed")]).counts).toEqual({ passed: 1, failed: 2, inconclusive: 0, securityPassed: 1, securityFailed: 1, continuityFailed: 1 });
  });
});

describe("incident outcome", () => {
  it("never maps anything but a full pass to contained, and inconclusive to nothing", () => {
    expect(incidentOutcomeFor("passed")).toBe("contained");
    expect(incidentOutcomeFor("partially_verified")).toBe("partially_contained");
    expect(incidentOutcomeFor("failed")).toBe("containment_failed");
    expect(incidentOutcomeFor("inconclusive")).toBeNull();
  });
});

describe("path block on the pinned graph", () => {
  const edges = [
    { id: "e1", sourceNodeId: "agent:p", targetNodeId: "resource:w" },
    { id: "e2", sourceNodeId: "agent:p", targetNodeId: "agent:a" },
    { id: "e3", sourceNodeId: "agent:a", targetNodeId: "resource:c" },
    { id: "e4", sourceNodeId: "agent:s", targetNodeId: "resource:c" },
  ];
  it("reports protected nodes still reachable after removing enforced edges", () => {
    expect(reachableProtected(edges, new Set(), ["agent:p"], ["resource:w", "resource:c"])).toEqual(["resource:c", "resource:w"]);
    expect(reachableProtected(edges, new Set(["e1"]), ["agent:p"], ["resource:w", "resource:c"])).toEqual(["resource:c"]); // indirect path via agent:a
    expect(reachableProtected(edges, new Set(["e1", "e2"]), ["agent:p"], ["resource:w", "resource:c"])).toEqual([]);
  });
});
