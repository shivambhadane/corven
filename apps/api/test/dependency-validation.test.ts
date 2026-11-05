import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authority, mkAgent, mkResource, operational, resourceDep } from "./dep-helpers.js";
import { client, createCtx, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());
const D = "/api/v1/dependencies";

describe("entity validation", () => {
  it("rejects a missing source (422 ENDPOINT_NOT_FOUND)", async () => {
    const op = who("operator");
    const b = await mkAgent(api, op);
    const res = await api.post(D, op, authority(randomUUID(), b));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "ENDPOINT_NOT_FOUND", details: { role: "source" } });
  });

  it("rejects a missing target", async () => {
    const op = who("operator");
    const a = await mkAgent(api, op);
    const res = await api.post(D, op, authority(a, randomUUID()));
    expect(res.status).toBe(422);
    expect(res.body.error.details).toMatchObject({ role: "target" });
  });

  it("rejects a resource id used where an agent is declared (wrong entity type)", async () => {
    const op = who("operator");
    const [a, r] = [await mkAgent(api, op), await mkResource(api, op)];
    const res = await api.post(D, op, authority(a, r)); // r is a resource, declared as agent
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ENDPOINT_NOT_FOUND");
  });

  it.each([
    ["authority agent -> resource", (a: string, _b: string, r: string) => ({ ...authority(a, r), targetType: "resource" })],
    ["authority resource -> agent", (a: string, _b: string, r: string) => ({ ...authority(r, a), sourceType: "resource" })],
    ["resource dependency agent -> agent", (a: string, b: string) => ({ ...resourceDep(a, b), targetType: "agent" })],
    ["resource dependency resource -> agent", (a: string, _b: string, r: string) => ({ ...resourceDep(r, a), sourceType: "resource", targetType: "agent" })],
    ["operational resource -> resource", (_a: string, _b: string, r: string, r2: string) => ({ ...operational(r, r2), sourceType: "resource", targetType: "resource" })],
  ])("rejects incompatible endpoint types: %s", async (_l, build) => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const [r, r2] = [await mkResource(api, op), await mkResource(api, op)];
    const res = await api.post(D, op, build(a, b, r, r2));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("RELATIONSHIP_TYPE_MISMATCH");
    expect(res.body.error.message).toMatch(/allowed/);
  });

  it("rejects a cross-organization relationship, indistinguishably from a missing entity", async () => {
    const orgA = who("operator");
    const orgB = who("operator");
    const [a, bOther] = [await mkAgent(api, orgA), await mkAgent(api, orgB)];
    const res = await api.post(D, orgA, authority(a, bOther));
    expect(res.status).toBe(422);
    const missing = await api.post(D, orgA, authority(a, randomUUID()));
    expect(res.body.error).toEqual(missing.body.error);
    // and for a foreign resource
    const rOther = await mkResource(api, orgB);
    expect((await api.post(D, orgA, resourceDep(a, rOther))).status).toBe(422);
  });

  it.each([
    ["authority", (a: string) => authority(a, a)],
    ["operational", (a: string) => operational(a, a)],
  ])("rejects self-reference (%s)", async (_l, build) => {
    const op = who("operator");
    const a = await mkAgent(api, op);
    const res = await api.post(D, op, build(a));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("SELF_REFERENCE");
  });

  it("allows an agent and a resource that happen to share nothing but are different types (no false self-reference)", async () => {
    const op = who("operator");
    const [a, r] = [await mkAgent(api, op), await mkResource(api, op)];
    expect((await api.post(D, op, resourceDep(a, r))).status).toBe(201);
  });

  it("does not require the agents to be active (a compromised agent can still be mapped)", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    await api.post(`/api/v1/agents/${a}/status`, op, { status: "compromised", reason: "seen exfiltrating" });
    expect((await api.post(D, op, authority(a, b))).status).toBe(201);
  });
});

describe("database-level integrity (defence in depth)", () => {
  const q = (sql: string, p: unknown[] = []) => ctx.handle.pool.query(sql, p);

  it("a composite FK rejects a cross-organization reference even if the application is bypassed", async () => {
    const orgA = who("operator");
    const orgB = who("operator");
    const [a, bAgent] = [await mkAgent(api, orgA), await mkAgent(api, orgB)];
    await expect(
      q(
        `insert into dependencies (organization_id, source_type, source_agent_id, target_type, target_agent_id, dependency_type, relationship, provenance, confidence)
         values ($1,'agent',$2,'agent',$3,'operational','x','{"source":"manual"}',1)`,
        [orgA.org, a, bAgent],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("a nonexistent id is rejected by the FK", async () => {
    const op = who("operator");
    const a = await mkAgent(api, op);
    await expect(
      q(
        `insert into dependencies (organization_id, source_type, source_agent_id, target_type, target_agent_id, dependency_type, relationship, provenance, confidence)
         values ($1,'agent',$2,'agent',$3,'operational','x','{"source":"manual"}',1)`,
        [op.org, a, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("CHECK constraints reject mismatched type/reference columns, self-reference and bad matrix", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const base = `insert into dependencies (organization_id, source_type, source_agent_id, source_resource_id, target_type, target_agent_id, target_resource_id, dependency_type, relationship, provenance, confidence) values `;
    const bad: Array<[string, unknown[]]> = [
      [`($1,'agent',$2,$3,'agent',$4,null,'operational','x','{}',1)`, [op.org, a, randomUUID(), b]], // both source columns set
      [`($1,'agent',null,null,'agent',$2,null,'operational','x','{}',1)`, [op.org, b]], // no source column
      [`($1,'agent',$2,null,'agent',$2,null,'operational','x','{}',1)`, [op.org, a]], // self reference
      [`($1,'agent',$2,null,'agent',$3,null,'operational','x','{}',1.5)`, [op.org, a, b]], // confidence
      [`($1,'agent',$2,null,'agent',$3,null,'friendship','x','{}',1)`, [op.org, a, b]], // type
    ];
    for (const [values, params] of bad) {
      await expect(q(base + values, params)).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("agents and resources cannot be hard-deleted while referenced", async () => {
    const op = who("operator");
    const [a, r] = [await mkAgent(api, op), await mkResource(api, op)];
    await api.post(D, op, resourceDep(a, r));
    await expect(q("delete from resources where id=$1", [r])).rejects.toMatchObject({ code: "23503" });
    await expect(q("delete from agents where id=$1", [a])).rejects.toMatchObject({ code: "23503" });
  });
});

