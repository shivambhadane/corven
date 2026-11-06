import { describe, expect, it } from "vitest";
import { approvalDigest, assessRisk, requiredFor, validatePolicy } from "../src/modules/approval-service/core/binding.js";
import { DEFAULT_POLICY } from "../src/modules/approval-service/types.js";

const b = { organizationId: "o", incidentId: "i", planReferenceId: "r", planVersion: 1, planHash: "a".repeat(64), snapshotHash: "b".repeat(64), resultHash: "c".repeat(64) };

describe("approval digest", () => {
  it("is deterministic and independent of key order", () => {
    const reordered = { resultHash: b.resultHash, snapshotHash: b.snapshotHash, planHash: b.planHash, planVersion: 1, planReferenceId: "r", incidentId: "i", organizationId: "o" };
    expect(approvalDigest(b)).toBe(approvalDigest(reordered));
    expect(approvalDigest(b)).toMatch(/^[0-9a-f]{64}$/);
  });
  it.each(Object.keys(b))("changes when %s changes", (k) => {
    const v = b[k as keyof typeof b];
    const changed = { ...b, [k]: typeof v === "number" ? v + 1 : `${v}x` };
    expect(approvalDigest(changed)).not.toBe(approvalDigest(b));
  });
});

describe("risk and required approvals", () => {
  it("is elevated when the Containment Engine asked for approval", () => {
    expect(assessRisk({ approvalRequired: false, approvalReasons: [] })).toEqual({ risk: "standard", reasons: [] });
    expect(assessRisk({ approvalRequired: true, approvalReasons: ["affects_healthy_agent"] })).toEqual({ risk: "elevated", reasons: ["affects_healthy_agent"] });
    expect(assessRisk({ approvalReasons: ["cost_threshold"] }).risk).toBe("elevated");
    expect(assessRisk({}).risk).toBe("standard");
  });
  it("uses the elevated count for elevated plans", () => {
    expect(requiredFor(DEFAULT_POLICY, "standard")).toBe(1);
    expect(requiredFor(DEFAULT_POLICY, "elevated")).toBe(2);
  });
  it("defaults are conservative: separation of duties on, one-hour windows", () => {
    expect(DEFAULT_POLICY).toEqual({ requiredApprovals: 1, elevatedRequiredApprovals: 2, separationOfDuties: true, expiryMinutes: 60, executionWindowMinutes: 60 });
  });
});

describe("policy validation", () => {
  it("accepts sane policies and rejects the rest", () => {
    expect(validatePolicy(DEFAULT_POLICY)).toBeNull();
    expect(validatePolicy({ ...DEFAULT_POLICY, requiredApprovals: 0 })).toMatch(/requiredApprovals/);
    expect(validatePolicy({ ...DEFAULT_POLICY, requiredApprovals: 3, elevatedRequiredApprovals: 2 })).toMatch(/elevated/);
    expect(validatePolicy({ ...DEFAULT_POLICY, expiryMinutes: 1 })).toMatch(/expiry/);
    expect(validatePolicy({ ...DEFAULT_POLICY, executionWindowMinutes: 5000 })).toMatch(/executionWindow/);
    expect(validatePolicy({ ...DEFAULT_POLICY, requiredApprovals: 1.5 })).toMatch(/integers/);
  });
});
