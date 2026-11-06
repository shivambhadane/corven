import { describe, expect, it } from "vitest";
import { InMemoryArkiv, InMemoryChain, JsonRpcEthereumAnchor } from "../src/modules/evidence-service/adapters/anchors.js";
import { sealedVsCurrent } from "../src/modules/evidence-service/core/consistency.js";

const doc = () => ({
  incident: { id: "i", title: "t", descriptionHash: "d", severity: "high", detectionSource: "manual", detectionReference: null, createdBy: "u", createdAt: "x", stateHistory: [{ to: "detected" }, { to: "investigating" }] },
  agents: [{ agentId: "a", relationship: "compromised" }],
  resources: [{ resourceId: "r" }],
  analysis: [{ referenceId: "p", kind: "containment_plan", version: 1, snapshotId: "s", snapshotHash: "h", resultHash: "rh", planHash: "ph", planStatus: "feasible" }],
  approvals: [{ approvalId: "ap", planHash: "ph", approvalDigest: "dg", planReferenceId: "p", requestedBy: "u", createdAt: "x", status: "approved", decisions: [{ decidedBy: "v", decision: "approve" }] }],
  enforcement: [{ actionId: "e", kind: "revoke_resource_access", planHash: "ph", edgeId: "ed", agentId: "a", resourceId: "r", approvalBasis: "plan_approval", requestedBy: "u", status: "executed", history: [{ status: "pending" }, { status: "executed" }] }],
  verification: [{ runId: "v1", planHash: "ph", snapshotHash: "h", resultHash: "vh", attempt: 1, approvalId: "ap" }],
});
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe("sealed vs current", () => {
  it("accepts identical content and later additions", () => {
    expect(sealedVsCurrent(doc(), doc())).toEqual([]);
    const later = clone(doc());
    later.incident.stateHistory.push({ to: "contained" });
    later.agents.push({ agentId: "b", relationship: "affected" });
    later.approvals[0]!.status = "invalidated"; // status moves legitimately
    later.enforcement[0]!.status = "rolled_back"; // a rollback appends history and moves the status
    later.enforcement[0]!.history.push({ status: "rolled_back" });
    later.approvals[0]!.decisions.push({ decidedBy: "w", decision: "approve" });
    later.analysis.push({ referenceId: "q", kind: "blast_radius", version: 1, snapshotId: "s", snapshotHash: "h", resultHash: "x", planHash: null as never, planStatus: null as never });
    expect(sealedVsCurrent(doc(), later)).toEqual([]);
  });
  it.each([
    ["a changed state history entry", (d: ReturnType<typeof doc>) => void (d.incident.stateHistory[1] = { to: "false_positive" })],
    ["a changed title", (d: ReturnType<typeof doc>) => void (d.incident.title = "other")],
    ["a changed plan hash", (d: ReturnType<typeof doc>) => void (d.analysis[0]!.planHash = "zz")],
    ["a changed approval digest", (d: ReturnType<typeof doc>) => void (d.approvals[0]!.approvalDigest = "zz")],
    ["a changed decision", (d: ReturnType<typeof doc>) => void (d.approvals[0]!.decisions[0] = { decidedBy: "v", decision: "reject" })],
    ["a changed enforcement action", (d: ReturnType<typeof doc>) => void (d.enforcement[0]!.kind = "suspend_agent")],
    ["an enforcement status that contradicts its history", (d: ReturnType<typeof doc>) => void (d.enforcement[0]!.status = "failed")],
    ["a rewritten enforcement history", (d: ReturnType<typeof doc>) => void (d.enforcement[0]!.history[1] = { status: "failed" })],
    ["a changed verification result", (d: ReturnType<typeof doc>) => void (d.verification[0]!.resultHash = "zz")],
    ["a changed association", (d: ReturnType<typeof doc>) => void (d.agents[0]!.relationship = "observed")],
  ])("flags %s", (_n, mutate) => {
    const cur = clone(doc());
    mutate(cur);
    expect(sealedVsCurrent(doc(), cur).length).toBeGreaterThan(0);
  });
  it.each(["analysis", "approvals", "enforcement", "verification", "agents", "resources"] as const)("flags a sealed %s entry that disappeared", (section) => {
    const cur = clone(doc());
    (cur[section] as unknown[]).length = 0;
    expect(sealedVsCurrent(doc(), cur).length).toBeGreaterThan(0);
  });
});

describe("test doubles behave like the real thing where it matters", () => {
  it("in-memory chain: a pending tx has no confirmations; confirmations grow with blocks; reverted is reverted", async () => {
    const c = new InMemoryChain();
    const { txHash } = await c.submit("a".repeat(64));
    expect((await c.status(txHash)).state).toBe("pending");
    c.mine();
    expect(await c.status(txHash)).toMatchObject({ state: "mined", confirmations: 1 });
    c.mine(2);
    expect((await c.status(txHash)).confirmations).toBe(4);
    const { txHash: bad } = await c.submit("b".repeat(64));
    c.revert(bad);
    expect((await c.status(bad)).state).toBe("reverted");
    expect((await c.status("0xnope")).state).toBe("not_found");
    expect((await c.status(txHash)).dataContainsHash("a".repeat(64))).toBe(true);
  });
  it("in-memory arkiv stores and returns payloads", async () => {
    const a = new InMemoryArkiv();
    const { entityKey } = await a.publish({ evidenceId: "e", contentHash: "h", schemaVersion: 1, sequence: 1 });
    expect(await a.fetch(entityKey)).toMatchObject({ contentHash: "h" });
    expect(await a.fetch("0xmissing")).toBeNull();
  });
});

describe("JSON-RPC Ethereum client (read side, fake transport)", () => {
  const rpc = (answers: Record<string, unknown>) => async (_u: string, init: { body: string }) => {
    const { method } = JSON.parse(init.body);
    return { ok: true, json: async () => ({ result: answers[method] ?? null }) };
  };
  const hash = "c".repeat(64);
  it("reports mined, successful transactions with confirmations and the data they carry", async () => {
    const c = new JsonRpcEthereumAnchor("http://rpc", 1, null, null, rpc({ eth_getTransactionReceipt: { status: "0x1", blockNumber: "0x64" }, eth_getTransactionByHash: { input: `0x${hash}` }, eth_blockNumber: "0x66" }));
    const s = await c.status("0xabc");
    expect(s).toMatchObject({ state: "mined", blockNumber: 100, confirmations: 3 });
    expect(s.dataContainsHash(hash)).toBe(true);
    expect(s.dataContainsHash("d".repeat(64))).toBe(false);
  });
  it("reports pending, reverted and unknown transactions", async () => {
    const tx = { input: "0x" };
    expect((await new JsonRpcEthereumAnchor("http://rpc", 1, null, null, rpc({ eth_getTransactionByHash: tx, eth_blockNumber: "0x10" })).status("0x1")).state).toBe("pending");
    expect((await new JsonRpcEthereumAnchor("http://rpc", 1, null, null, rpc({ eth_getTransactionReceipt: { status: "0x0", blockNumber: "0x1" }, eth_getTransactionByHash: tx, eth_blockNumber: "0x10" })).status("0x1")).state).toBe("reverted");
    expect((await new JsonRpcEthereumAnchor("http://rpc", 1, null, null, rpc({ eth_blockNumber: "0x10" })).status("0x1")).state).toBe("not_found");
  });
  it("surfaces RPC errors and refuses to submit without a signer", async () => {
    const bad = new JsonRpcEthereumAnchor("http://rpc", 1, null, null, async () => ({ ok: false, json: async () => ({}) }));
    await expect(bad.status("0x1")).rejects.toThrow(/failed/);
    await expect(new JsonRpcEthereumAnchor("http://rpc", 1, null).submit(hash)).rejects.toThrow(/No transaction signer/);
  });
});
