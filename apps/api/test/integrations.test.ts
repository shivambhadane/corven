import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { devHeaderAuthenticator } from "../src/auth/dev-auth.js";
import { createDb, type DbHandle } from "../src/db/client.js";
import { defaultEvidenceConfig, InMemoryArkiv } from "../src/modules/evidence-service/index.js";
import { who } from "./helpers.js";

let handle: DbHandle;
let bare: FastifyInstance;
let wired: FastifyInstance;
const lookups: string[] = [];
const h = (w = who("viewer")) => ({ "x-dev-actor-id": w.actor, "x-dev-org-id": w.org, "x-dev-role": w.role });

beforeAll(async () => {
  handle = createDb(inject("dbUrl"));
  bare = await buildApp({ db: handle.db, authenticate: devHeaderAuthenticator, integrations: { ethereumState: { state: "not_configured", reason: "EVIDENCE_ANCHOR_CONTRACT_ADDRESS is empty" } } });
  wired = await buildApp({
    db: handle.db,
    authenticate: devHeaderAuthenticator,
    evidenceConfig: defaultEvidenceConfig({ arkiv: new InMemoryArkiv() }),
    integrations: {
      ens: {
        network: "Ethereum Sepolia",
        resolveName: async (n) => {
          lookups.push(n);
          if (n === "boom.eth") throw new Error("rpc down");
          return n === "corven.eth" ? "0x1111111111111111111111111111111111111111" : null;
        },
      },
    },
  });
});
afterAll(async () => {
  await bare.close();
  await wired.close();
  await handle.close();
});

describe("integrations status", () => {
  it("requires authentication", async () => {
    expect((await bare.inject({ url: "/api/v1/integrations" })).statusCode).toBe(401);
  });

  it("reports honest states and reasons, and never claims Chainlink CRE works", async () => {
    const d = (await bare.inject({ url: "/api/v1/integrations", headers: h() })).json().data;
    expect(d.arkiv.state).toBe("not_configured");
    expect(d.ethereum).toMatchObject({ state: "not_configured", reason: "EVIDENCE_ANCHOR_CONTRACT_ADDRESS is empty", contractAddress: null });
    expect(d.ens.state).toBe("not_configured");
    expect(d.chainlinkCre.state).toBe("not_implemented");
    const w = (await wired.inject({ url: "/api/v1/integrations", headers: h() })).json().data;
    expect(w.arkiv.state).toBe("configured");
    expect(w.ens.state).toBe("configured");
  });

  it("never leaks secrets or RPC URLs", async () => {
    const body = (await wired.inject({ url: "/api/v1/integrations", headers: h() })).body;
    expect(body).not.toMatch(/private|secret|api[_-]?key|https?:\/\/[^"]*rpc|alchemy|infura/i);
  });
});

describe("ENS resolution", () => {
  it("resolves through the configured resolver, and reports unresolved names as unresolved", async () => {
    const ok = (await wired.inject({ method: "POST", url: "/api/v1/integrations/ens/resolve", headers: h(), payload: { name: "Corven.eth" } })).json().data;
    expect(ok).toEqual({ name: "corven.eth", network: "Ethereum Sepolia", address: "0x1111111111111111111111111111111111111111", resolved: true });
    const none = (await wired.inject({ method: "POST", url: "/api/v1/integrations/ens/resolve", headers: h(), payload: { name: "nobody.eth" } })).json().data;
    expect(none.resolved).toBe(false);
  });

  it("fails clearly when the network fails or ENS is not configured, and validates input", async () => {
    const boom = await wired.inject({ method: "POST", url: "/api/v1/integrations/ens/resolve", headers: h(), payload: { name: "boom.eth" } });
    expect(boom.statusCode).toBe(502);
    expect(boom.json().error.code).toBe("ENS_UNAVAILABLE");
    expect((await bare.inject({ method: "POST", url: "/api/v1/integrations/ens/resolve", headers: h(), payload: { name: "corven.eth" } })).statusCode).toBe(503);
    expect((await wired.inject({ method: "POST", url: "/api/v1/integrations/ens/resolve", headers: h(), payload: { name: "no spaces.eth" } })).statusCode).toBe(400);
    expect((await wired.inject({ method: "POST", url: "/api/v1/integrations/ens/resolve", headers: h(), payload: { name: "x.eth", extra: 1 } })).statusCode).toBe(400);
  });

  it("is rate limited per organization", async () => {
    const w = who("viewer");
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await wired.inject({ method: "POST", url: "/api/v1/integrations/ens/resolve", headers: h(w), payload: { name: "nobody.eth" } })).statusCode;
    expect(last).toBe(429);
  });
});
