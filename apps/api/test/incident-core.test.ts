import { describe, expect, it } from "vitest";
import { allowedFrom, ANALYSIS_STATES, edgeFor, PLAN_STATES, TRANSITIONS } from "../src/modules/incident-management/core/state-machine.js";
import { findSecretInData, findSecretInText, safeCorrelationId } from "../src/modules/incident-management/core/validation.js";
import { STATUSES, type IncidentStatus } from "../src/modules/incident-management/types.js";

describe("incident state machine", () => {
  it("defines every status, and every edge points at a real status", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...STATUSES].sort());
    for (const [from, edges] of Object.entries(TRANSITIONS)) {
      for (const e of edges) {
        expect(STATUSES).toContain(e.to);
        expect(e.to).not.toBe(from); // no self-transitions
        expect(e.actors.length).toBeGreaterThan(0);
      }
      const targets = edges.map((e) => e.to);
      expect(new Set(targets).size).toBe(targets.length); // no duplicate edges
    }
  });

  it("every status is reachable from detected", () => {
    const seen = new Set<IncidentStatus>(["detected"]);
    const queue: IncidentStatus[] = ["detected"];
    while (queue.length) {
      for (const e of allowedFrom(queue.shift()!)) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        queue.push(e.to);
      }
    }
    expect([...seen].sort()).toEqual([...STATUSES].sort());
  });

  it("no person can assert a fact only a trusted module can establish", () => {
    const systemOnlyTargets: IncidentStatus[] = ["approved", "rejected", "containing", "verifying", "contained", "partially_contained", "containment_failed"];
    for (const edges of Object.values(TRANSITIONS)) {
      for (const e of edges) if (systemOnlyTargets.includes(e.to)) expect(e.actors, `-> ${e.to}`).toEqual(["system"]);
    }
  });

  it("contained is only reachable from verifying, so submitting actions can never mean contained", () => {
    const into = Object.entries(TRANSITIONS).filter(([, edges]) => edges.some((e) => e.to === "contained")).map(([from]) => from);
    expect(into).toEqual(["verifying"]);
    for (const from of ["containing", "approved", "awaiting_approval"] as const) expect(edgeFor(from, "contained")).toBeUndefined();
  });

  it("failed enforcement can never lead to contained without a new plan and a new run", () => {
    expect(edgeFor("containment_failed", "contained")).toBeUndefined();
    expect(allowedFrom("containment_failed").map((e) => e.to).sort()).toEqual(["containment_planned", "investigating"]);
  });

  it("partial containment is its own state and cannot become contained directly", () => {
    expect(edgeFor("partially_contained", "contained")).toBeUndefined();
    expect(edgeFor("verifying", "partially_contained")).toBeDefined();
    expect(edgeFor("partially_contained", "resolved")?.guards).toContain("residual_risk_acknowledged");
  });

  it("resolution comes only from contained or acknowledged partial containment", () => {
    const into = Object.entries(TRANSITIONS).filter(([, edges]) => edges.some((e) => e.to === "resolved")).map(([from]) => from).sort();
    expect(into).toEqual(["contained", "partially_contained"]);
  });

  it("closing keeps history and only recovery leaves closed", () => {
    expect(allowedFrom("closed")).toEqual([{ to: "investigating", actors: ["human"], recovery: true }]);
    for (const from of ["resolved", "false_positive", "contained"] as const) expect(edgeFor(from, "investigating")?.recovery).toBe(true);
    expect(edgeFor("false_positive", "closed")).toBeDefined();
    expect(edgeFor("detected", "closed")).toBeUndefined();
  });

  it("a plan is required before planning and a feasible one before approval", () => {
    expect(edgeFor("investigating", "containment_planned")?.guards).toContain("fresh_plan");
    expect(edgeFor("containment_planned", "awaiting_approval")?.guards).toContain("feasible_plan");
    expect(edgeFor("investigating", "awaiting_approval")).toBeUndefined();
    expect(edgeFor("investigating", "approved")).toBeUndefined();
  });

  it("plans are locked once approval is requested", () => {
    for (const s of ["awaiting_approval", "approved", "containing", "verifying", "contained", "resolved", "closed"] as const) expect(PLAN_STATES.has(s)).toBe(false);
    for (const s of PLAN_STATES) expect(ANALYSIS_STATES.has(s)).toBe(true);
  });
});

describe("secret guard", () => {
  it.each([
    ["-----BEGIN RSA PRIVATE KEY-----\nabc", "private key"],
    ["key AKIAABCDEFGHIJKLMNOP leaked", "AWS"],
    ["Authorization: Bearer abcdefghijklmnop1234", "bearer"],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop", "JSON web token"],
    [`wallet key 0x${"ab".repeat(32)}`, "hex"],
    ["password=hunter2hunter2", "inline credential"],
    ["api_key: abcdef123456", "inline credential"],
  ])("flags %s", (text) => expect(findSecretInText(text)).not.toBeNull());

  it("leaves ordinary incident prose alone", () => {
    expect(findSecretInText("Payment agent started calling the wallet service outside its workflow at 14:02.")).toBeNull();
    expect(findSecretInText("Rotated the token for the support agent (ticket 4411).")).toBeNull();
    expect(findSecretInText("tx 0x" + "ab".repeat(20))).toBeNull(); // an address-length hash is not a private key
  });

  it("finds secret keys and values at any depth in structured data", () => {
    expect(findSecretInData({ a: { apiKey: "x" } })).toBe("a.apiKey");
    expect(findSecretInData({ list: [{ ok: 1 }, { note: "password=abcdefgh" }] })).toBe("list[1].note");
    expect(findSecretInData({ planHash: "abc", count: 2 })).toBeNull();
  });
});

describe("correlation ids", () => {
  it("keeps safe ids and replaces anything else", () => {
    expect(safeCorrelationId("req-123:abc.d", "fb")).toBe("req-123:abc.d");
    expect(safeCorrelationId("bad id\nwith newline", "fb")).toBe("fb");
    expect(safeCorrelationId("x".repeat(101), "fb")).toBe("fb");
    expect(safeCorrelationId(undefined, "fb")).toBe("fb");
  });
});
