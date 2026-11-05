import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/errors.js";
import {
  assertSafeMetadata,
  normalizeCapabilities,
  normalizeIdentities,
} from "../src/modules/agent-registry/policies/agent-input.policy.js";
import {
  initialStatus,
  permissionForTransition,
  transitionKind,
  validateReason,
} from "../src/modules/agent-registry/policies/agent-status.policy.js";
import { AGENT_STATUSES, type AgentStatus } from "../src/modules/agent-registry/types/agent.types.js";

describe("status policy (exhaustive)", () => {
  const expected: Record<string, "ordinary" | "recovery" | undefined> = {
    "active>suspended": "ordinary",
    "active>compromised": "ordinary",
    "active>inactive": "ordinary",
    "suspended>active": "ordinary",
    "suspended>compromised": "ordinary",
    "suspended>inactive": "ordinary",
    "compromised>active": "recovery",
    "compromised>suspended": "recovery",
    "compromised>inactive": "recovery",
    "inactive>active": "ordinary",
    "inactive>compromised": "ordinary",
  };
  for (const from of AGENT_STATUSES) {
    for (const to of AGENT_STATUSES) {
      const want = expected[`${from}>${to}`];
      it(`${from} -> ${to}: ${want ?? "rejected"}`, () => {
        if (want) expect(transitionKind(from as AgentStatus, to as AgentStatus)).toBe(want);
        else expect(() => transitionKind(from as AgentStatus, to as AgentStatus)).toThrow();
      });
    }
  }

  it("maps kinds to permissions and enforces reasons", () => {
    expect(permissionForTransition("ordinary")).toBe("agent:status");
    expect(permissionForTransition("recovery")).toBe("agent:recover");
    expect(() => validateReason("ordinary", "  ")).toThrow();
    expect(() => validateReason("recovery", "too short")).toThrow();
    expect(() => validateReason("recovery", "long enough reason")).not.toThrow();
  });

  it("registration always starts active", () => expect(initialStatus()).toBe("active"));
});

describe("input policy", () => {
  it("normalises capabilities", () => {
    expect(normalizeCapabilities([" B.c ", "a.b", "b.c"])).toEqual(["a.b", "b.c"]);
    expect(() => normalizeCapabilities(["bad"])).toThrow(ValidationError);
  });

  it("flags secret-looking metadata, including nested and in arrays", () => {
    expect(() => assertSafeMetadata({ ok: 1 })).not.toThrow();
    for (const bad of [{ password: "x" }, { a: { api_key: "x" } }, { list: [{ privateKey: "x" }] }, { Authorization: "x" }, { mnemonic: "x" }]) {
      expect(() => assertSafeMetadata(bad)).toThrow(ValidationError);
    }
  });

  it("limits metadata size and depth", () => {
    expect(() => assertSafeMetadata({ big: "x".repeat(9000) })).toThrow(ValidationError);
    expect(() => assertSafeMetadata({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } })).toThrow(ValidationError);
  });

  it("normalises identities and rejects duplicates", () => {
    expect(normalizeIdentities([{ identityType: "ens", identityValue: " A.eth " }])[0]).toMatchObject({ identityValue: "a.eth", chainId: null });
    expect(() => normalizeIdentities([{ identityType: "ens", identityValue: "a.eth" }, { identityType: "ens", identityValue: "A.ETH" }])).toThrow(ValidationError);
  });
});
