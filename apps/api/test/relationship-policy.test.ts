import { describe, expect, it } from "vitest";
import {
  assertCompatibleEndpoints, assertFreshness, assertNotSelfReference, assertRequiredMetadata, forbidsCycles, resolveConfidence,
} from "../src/modules/dependency-registry/policies/relationship.policy.js";
import { DEPENDENCY_TYPES, ENTITY_TYPES, type Endpoint } from "../src/modules/dependency-registry/types/dependency.types.js";

const ep = (type: Endpoint["type"], id = "x"): Endpoint => ({ type, id });

describe("endpoint compatibility matrix (exhaustive)", () => {
  const allowed = new Set([
    "authority:agent>agent",
    "resource:agent>resource",
    "operational:agent>agent",
    "operational:agent>resource",
    "operational:resource>agent",
  ]);
  for (const type of DEPENDENCY_TYPES) {
    for (const s of ENTITY_TYPES) {
      for (const t of ENTITY_TYPES) {
        const key = `${type}:${s}>${t}`;
        it(`${key}: ${allowed.has(key) ? "allowed" : "rejected"}`, () => {
          const run = () => assertCompatibleEndpoints(type, ep(s, "a"), ep(t, "b"));
          if (allowed.has(key)) expect(run).not.toThrow();
          else expect(run).toThrowError(/cannot go from/);
        });
      }
    }
  }
});

describe("self-reference", () => {
  it("rejects same type and id only", () => {
    expect(() => assertNotSelfReference(ep("agent", "a"), ep("agent", "a"))).toThrow();
    expect(() => assertNotSelfReference(ep("agent", "a"), ep("agent", "b"))).not.toThrow();
    expect(() => assertNotSelfReference(ep("agent", "a"), ep("resource", "a"))).not.toThrow();
  });
});

describe("required metadata", () => {
  it("authority needs a dotted lowercase scope", () => {
    expect(() => assertRequiredMetadata("authority", { scope: "payment.execute" })).not.toThrow();
    expect(() => assertRequiredMetadata("authority", { scope: "payment" })).not.toThrow();
    for (const bad of [{}, { scope: "" }, { scope: 5 }, { scope: "Payment.Execute" }, { scope: "a b" }]) {
      expect(() => assertRequiredMetadata("authority", bad)).toThrow();
    }
  });
  it("resource needs a known accessLevel; operational needs nothing", () => {
    for (const l of ["read", "write", "admin"]) expect(() => assertRequiredMetadata("resource", { accessLevel: l })).not.toThrow();
    expect(() => assertRequiredMetadata("resource", { accessLevel: "owner" })).toThrow();
    expect(() => assertRequiredMetadata("resource", {})).toThrow();
    expect(() => assertRequiredMetadata("operational", {})).not.toThrow();
  });
});

describe("cycles, confidence, freshness", () => {
  it("only authority forbids cycles", () => {
    expect(DEPENDENCY_TYPES.filter(forbidsCycles)).toEqual(["authority"]);
  });
  it("confidence defaults to 1 only for manual", () => {
    expect(resolveConfidence("manual", undefined)).toBe(1);
    expect(resolveConfidence("manual", 0.2)).toBe(0.2);
    for (const s of ["imported", "discovered", "inferred"]) expect(() => resolveConfidence(s, undefined)).toThrow();
    expect(resolveConfidence("inferred", 0)).toBe(0);
  });
  it("freshness rules", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(() => assertFreshness(null, null, now)).not.toThrow();
    expect(() => assertFreshness(new Date("2026-05-01T00:00:00Z"), new Date("2026-05-02T00:00:00Z"), now)).not.toThrow();
    expect(() => assertFreshness(new Date("2026-07-01T00:00:00Z"), null, now)).toThrow();
    expect(() => assertFreshness(null, new Date("2026-07-01T00:00:00Z"), now)).toThrow();
    expect(() => assertFreshness(new Date("2026-05-02T00:00:00Z"), new Date("2026-05-01T00:00:00Z"), now)).toThrow();
    expect(() => assertFreshness(new Date("2026-06-01T00:03:00Z"), null, now)).not.toThrow(); // within clock skew
  });
});
