import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createCtx, uniqueName, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());

describe("resource references and types", () => {
  it("stores externalReference and metadata, and supports mcp_server and queue", async () => {
    const op = who("operator");
    const res = await api.post("/api/v1/resources", op, { name: uniqueName("r"), resourceType: "mcp_server", externalReference: "mcp://tools", metadata: { transport: "stdio" } });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ resourceType: "mcp_server", externalReference: "mcp://tools", metadata: { transport: "stdio" } });
    expect((await api.post("/api/v1/resources", op, { name: uniqueName("q"), resourceType: "queue" })).status).toBe(201);
  });

  it("enforces externalReference uniqueness per organization, case-insensitively", async () => {
    const op = who("operator");
    await api.post("/api/v1/resources", op, { name: uniqueName("a"), resourceType: "api", externalReference: "customer-api" });
    const dup = await api.post("/api/v1/resources", op, { name: uniqueName("b"), resourceType: "api", externalReference: "CUSTOMER-API" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("RESOURCE_EXTERNAL_REF_CONFLICT");
    expect((await api.post("/api/v1/resources", who("operator"), { name: uniqueName("c"), resourceType: "api", externalReference: "customer-api" })).status).toBe(201);
  });

  it("resolves by external reference within the organization", async () => {
    const orgA = who("operator");
    const orgB = who("operator");
    const r = (await api.post("/api/v1/resources", orgA, { name: uniqueName("a"), resourceType: "api", externalReference: "ref-x" })).body.data;
    const repo = ctx.depRegistry.resourcesRepo;
    expect((await repo.findByExternalReference(ctx.handle.db, orgA.org, "REF-X"))?.id).toBe(r.id);
    expect(await repo.findByExternalReference(ctx.handle.db, orgB.org, "ref-x")).toBeNull();
  });

  it("rejects secret-looking metadata and malformed references", async () => {
    const op = who("operator");
    expect((await api.post("/api/v1/resources", op, { name: "x1", resourceType: "api", metadata: { api_key: "abc" } })).status).toBe(400);
    expect((await api.post("/api/v1/resources", op, { name: "x2", resourceType: "api", externalReference: "has space" })).status).toBe(400);
  });
});
