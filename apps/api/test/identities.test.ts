import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createCtx, validAgent, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());

const create = async (w: ReturnType<typeof who>, over = {}) => (await api.post("/api/v1/agents", w, validAgent(over))).body.data;
const ens = (v: string) => ({ identityType: "ens", identityValue: v });

describe("identities", () => {
  it("stores identity metadata as unverified", async () => {
    const op = who("operator");
    const a = await create(op);
    const res = await api.put(`/api/v1/agents/${a.id}/identities`, op, {
      identities: [ens("Billing.Corven.ETH"), { identityType: "evm_address", identityValue: "0x" + "Ab".repeat(20), chainId: 11155111 }],
    });
    expect(res.status).toBe(200);
    const ids = res.body.data.identities;
    expect(ids).toHaveLength(2);
    for (const i of ids) expect(i).toMatchObject({ verificationStatus: "unverified", verifiedAt: null });
    expect(ids.find((i: any) => i.identityType === "ens").identityValue).toBe("billing.corven.eth");
    expect(ids.find((i: any) => i.identityType === "evm_address").identityValue).toBe("0x" + "ab".repeat(20));
  });

  it("cannot be told to be verified by the caller", async () => {
    const op = who("admin");
    const a = await create(op);
    for (const extra of [{ verificationStatus: "verified" }, { verifiedAt: new Date().toISOString() }]) {
      const res = await api.put(`/api/v1/agents/${a.id}/identities`, op, { identities: [{ ...ens("x.eth"), ...extra }] });
      expect(res.status).toBe(400);
    }
    const reg = await api.post("/api/v1/agents", op, validAgent({ identities: [{ ...ens("y.eth"), verificationStatus: "verified" }] }));
    expect(reg.status).toBe(400);
  });

  it("rejects an invalid verification status via the service too", async () => {
    const admin = who("admin");
    const a = await create(admin, { identities: [ens("z.eth")] });
    const identityId = a.identities[0].id;
    const principal = { actorId: admin.actor, organizationId: admin.org, role: "admin" as const };
    await expect(
      ctx.registry.identities.recordVerification(principal, a.id, identityId, "totally-verified" as never),
    ).rejects.toThrow();
    const after = (await api.get(`/api/v1/agents/${a.id}`, admin)).body.data;
    expect(after.identities[0].verificationStatus).toBe("unverified");
  });

  it("only an authorized verification operation can mark an identity verified", async () => {
    const admin = who("admin");
    const a = await create(admin, { identities: [ens("v.eth")] });
    const identityId = a.identities[0].id;
    const asOperator = { actorId: admin.actor, organizationId: admin.org, role: "operator" as const };
    await expect(ctx.registry.identities.recordVerification(asOperator, a.id, identityId, "verified")).rejects.toMatchObject({ statusCode: 403 });

    const asAdmin = { actorId: admin.actor, organizationId: admin.org, role: "admin" as const };
    const v = await ctx.registry.identities.recordVerification(asAdmin, a.id, identityId, "verified");
    expect(v.verificationStatus).toBe("verified");
    expect(v.verifiedAt).toBeInstanceOf(Date);
    const audit = (await ctx.registry.repo.listAudit(ctx.handle.db, admin.org, a.id)).filter((x) => x.action === "agent.identity_verification_recorded");
    expect(audit).toHaveLength(1);
  });

  it("keeps verification for an unchanged identity but resets it when the value changes", async () => {
    const admin = who("admin");
    const a = await create(admin, { identities: [ens("keep.eth")] });
    const principal = { actorId: admin.actor, organizationId: admin.org, role: "admin" as const };
    await ctx.registry.identities.recordVerification(principal, a.id, a.identities[0].id, "verified");

    const same = await api.put(`/api/v1/agents/${a.id}/identities`, admin, { identities: [ens("KEEP.eth")] });
    expect(same.body.data.identities[0].verificationStatus).toBe("verified");

    const changed = await api.put(`/api/v1/agents/${a.id}/identities`, admin, { identities: [ens("other.eth")] });
    expect(changed.body.data.identities).toHaveLength(1);
    expect(changed.body.data.identities[0]).toMatchObject({ identityValue: "other.eth", verificationStatus: "unverified", verifiedAt: null });
  });

  it("the database refuses verified without verifiedAt (and vice versa)", async () => {
    const op = who("operator");
    const a = await create(op, { identities: [ens("db.eth")] });
    await expect(
      ctx.handle.pool.query("update agent_identities set verification_status='verified' where agent_id=$1", [a.id]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it.each([
    ["bad evm address", { identityType: "evm_address", identityValue: "0x123" }],
    ["bad ens name", { identityType: "ens", identityValue: "not an ens name" }],
    ["blank value", { identityType: "did", identityValue: "   " }],
    ["unknown type", { identityType: "passport", identityValue: "x" }],
    ["bad chain id", { identityType: "did", identityValue: "did:x:1", chainId: 0 }],
  ])("rejects %s", async (_l, identity) => {
    const op = who("operator");
    const a = await create(op);
    expect((await api.put(`/api/v1/agents/${a.id}/identities`, op, { identities: [identity] })).status).toBe(400);
  });

  it("rejects an identity already claimed by another agent in the org, allows it across orgs", async () => {
    const op = who("operator");
    await create(op, { identities: [ens("taken.eth")] });
    const b = await create(op);
    const clash = await api.put(`/api/v1/agents/${b.id}/identities`, op, { identities: [ens("TAKEN.eth")] });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("IDENTITY_CONFLICT");

    const other = who("operator");
    const c = await create(other);
    expect((await api.put(`/api/v1/agents/${c.id}/identities`, other, { identities: [ens("taken.eth")] })).status).toBe(200);
  });

  it("is isolated across organizations and forbids viewers", async () => {
    const op = who("operator");
    const a = await create(op);
    expect((await api.put(`/api/v1/agents/${a.id}/identities`, who("admin"), { identities: [] })).status).toBe(404);
    expect((await api.put(`/api/v1/agents/${a.id}/identities`, who("viewer", op.org), { identities: [] })).status).toBe(403);
  });
});
