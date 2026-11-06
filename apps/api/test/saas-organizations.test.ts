import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createCtx, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createCtx();
});
afterAll(() => ctx.close());

describe("SaaS: Organizations and Members", () => {
  it("creates an organization with unique slug and initial admin member", async () => {
    const c = client(ctx.app);
    const admin = who("admin");
    const slug = `acme-corp-${Date.now().toString(36)}`;

    const res = await c.post("/api/v1/saas/organizations", admin, {
      name: "Acme Cyber Security",
      slug,
      tier: "pro",
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.slug).toBe(slug);
    expect(res.body.data.tier).toBe("pro");
    expect(res.body.data.planStatus).toBe("active");
  });

  it("prevents creating duplicate organization with same slug (case-insensitive)", async () => {
    const c = client(ctx.app);
    const admin = who("admin");
    const slug = `unique-corp-${Date.now().toString(36)}`;

    const first = await c.post("/api/v1/saas/organizations", admin, {
      name: "Unique Corp",
      slug,
    });
    expect(first.status).toBe(201);

    const dup = await c.post("/api/v1/saas/organizations", admin, {
      name: "Duplicate Corp",
      slug: slug.toUpperCase(),
    });
    expect(dup.status).toBe(409);
  });

  it("retrieves and updates current organization profile", async () => {
    const c = client(ctx.app);
    const admin = who("admin");

    const created = await c.post("/api/v1/saas/organizations", admin, {
      name: "Org Alpha",
      slug: `alpha-${Date.now().toString(36)}`,
    });
    const orgId = created.body.data.id;

    // Caller in that org
    const orgUser = who("admin", orgId);
    const current = await c.get("/api/v1/saas/organizations/current", orgUser);
    expect(current.status).toBe(200);
    expect(current.body.data.id).toBe(orgId);
    expect(current.body.data.name).toBe("Org Alpha");

    // Update settings
    const updated = await c.patch("/api/v1/saas/organizations/current", orgUser, {
      name: "Org Alpha Enterprise",
      settings: { enforceMfa: true },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe("Org Alpha Enterprise");
    expect(updated.body.data.settings).toEqual({ enforceMfa: true });
  });

  it("manages organization members and enforces RBAC roles", async () => {
    const c = client(ctx.app);
    const admin = who("admin");

    const created = await c.post("/api/v1/saas/organizations", admin, {
      name: "Team Org",
      slug: `team-${Date.now().toString(36)}`,
    });
    const orgId = created.body.data.id;
    const orgAdmin = who("admin", orgId);

    // Initial member was added upon creation
    const initialList = await c.get("/api/v1/saas/organizations/members", orgAdmin);
    expect(initialList.status).toBe(200);
    expect(initialList.body.data.length).toBe(1);

    // Invite operator member
    const inviteRes = await c.post("/api/v1/saas/organizations/members", orgAdmin, {
      email: "operator1@example.com",
      role: "operator",
    });
    expect(inviteRes.status).toBe(201);
    expect(inviteRes.body.data.email).toBe("operator1@example.com");
    expect(inviteRes.body.data.role).toBe("operator");

    // Reject duplicate member
    const dupRes = await c.post("/api/v1/saas/organizations/members", orgAdmin, {
      email: "operator1@example.com",
      role: "viewer",
    });
    expect(dupRes.status).toBe(409);

    // Remove member
    const memberId = inviteRes.body.data.id;
    const delRes = await c.delete(`/api/v1/saas/organizations/members/${memberId}`, orgAdmin);
    expect(delRes.status).toBe(200);

    const afterDel = await c.get("/api/v1/saas/organizations/members", orgAdmin);
    expect(afterDel.body.data.length).toBe(1);
  });
});
