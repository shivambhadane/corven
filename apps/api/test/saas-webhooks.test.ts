import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebhookDispatcher, signWebhookPayload } from "../src/modules/saas/webhooks/webhook.dispatcher.js";
import { client, createCtx, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createCtx();
});
afterAll(() => ctx.close());

describe("SaaS: Webhooks and Event Pipeline", () => {
  it("registers a webhook with generated HMAC secret", async () => {
    const c = client(ctx.app);
    const admin = who("admin");

    const res = await c.post("/api/v1/saas/webhooks", admin, {
      url: "https://soc.company.internal/events",
      events: ["incident.detected", "containment.executed"],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.url).toBe("https://soc.company.internal/events");
    expect(res.body.data.secret.startsWith("whsec_")).toBe(true);
    expect(res.body.data.status).toBe("active");
  });

  it("rejects invalid webhook URLs", async () => {
    const c = client(ctx.app);
    const admin = who("admin");

    const res = await c.post("/api/v1/saas/webhooks", admin, {
      url: "ftp://invalid-url.com",
    });

    expect(res.status).toBe(400);
  });

  it("lists and deletes webhooks", async () => {
    const c = client(ctx.app);
    const admin = who("admin");

    const created = await c.post("/api/v1/saas/webhooks", admin, {
      url: "https://api.mycorp.com/hooks/corven",
    });
    const hookId = created.body.data.id;

    const list = await c.get("/api/v1/saas/webhooks", admin);
    expect(list.status).toBe(200);
    expect(list.body.data.some((h: { id: string }) => h.id === hookId)).toBe(true);

    const del = await c.delete(`/api/v1/saas/webhooks/${hookId}`, admin);
    expect(del.status).toBe(200);
    expect(del.body.data.id).toBe(hookId);
  });

  it("dispatches signed event to registered webhook and records delivery log", async () => {
    const admin = who("admin");
    const saas = ctx.app.saas;

    // Create webhook via service
    const hook = await saas.webhooks.createWebhook(
      { actorId: admin.actor, organizationId: admin.org, role: "admin" },
      { url: "https://mock.webhook.test/ingest", events: ["containment.approved"] },
    );

    let capturedHeaders: HeadersInit | undefined;
    let capturedBody: string | undefined;

    const mockFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      capturedBody = init?.body as string;
      return {
        ok: true,
        status: 200,
      } as Response;
    }) as typeof fetch;

    const customDispatcher = new WebhookDispatcher(ctx.handle.db, saas.webhookRepo, mockFetch);

    const eventPayload = {
      incidentId: "inc-100",
      planHash: "0x1234abcd",
      status: "approved",
    };

    const deliveries = await customDispatcher.dispatch(admin.org, "containment.approved", eventPayload);
    expect(deliveries.length).toBe(1);
    expect(deliveries[0]!.success).toBe(true);
    expect(deliveries[0]!.statusCode).toBe(200);
    expect(deliveries[0]!.event).toBe("containment.approved");

    // Verify signature header and structure
    expect(capturedHeaders).toBeDefined();
    const headersObj = capturedHeaders as Record<string, string>;
    expect(headersObj["X-Corven-Event"]).toBe("containment.approved");
    expect(headersObj["X-Corven-Delivery"]).toBeDefined();
    expect(headersObj["X-Corven-Timestamp"]).toBeDefined();

    const sigHeader = headersObj["X-Corven-Signature"];
    expect(sigHeader).toBeDefined();
    const match = /t=(\d+),v1=([0-9a-f]{64})/.exec(sigHeader!);
    expect(match).not.toBeNull();
    const timestamp = Number(match![1]);
    const receivedSig = match![2];

    const expectedSig = signWebhookPayload(hook.secret, timestamp, capturedBody!);
    expect(receivedSig).toBe(expectedSig);

    // Verify delivery history query via API
    const c = client(ctx.app);
    const delRes = await c.get(`/api/v1/saas/webhooks/deliveries?webhookId=${hook.id}`, admin);
    expect(delRes.status).toBe(200);
    expect(delRes.body.data.length).toBe(1);
    expect(delRes.body.data[0].success).toBe(true);
  });
});
