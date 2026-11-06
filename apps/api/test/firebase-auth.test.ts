import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, createLocalJWKSet, SignJWT, type JWK, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { buildApp } from "../src/app.js";
import { failClosedAuthenticator } from "../src/auth/dev-auth.js";
import { createFirebaseVerifier } from "../src/auth/firebase.js";
import { createDb, type DbHandle } from "../src/db/client.js";
import { MAX_ADMIN_ORGANIZATIONS, slugify } from "../src/modules/users/user.service.js";
import type { FastifyInstance } from "fastify";

const PROJECT = "corven-test-project";
const run = Date.now().toString(36);
const email = (n: string) => `${n}-${run}@example.test`;

let handle: DbHandle;
let app: FastifyInstance;
let priv: CryptoKey;
let other: CryptoKey;

async function token(o: { uid?: string; email?: string; verified?: boolean; aud?: string; iss?: string; key?: CryptoKey; exp?: string | number; alg?: string; omitEmail?: boolean } = {}) {
  const uid = o.uid ?? `uid-${randomUUID()}`;
  const claims: Record<string, unknown> = { email_verified: o.verified ?? true, name: "Test Person", auth_time: Math.floor(Date.now() / 1000) - 5 };
  if (!o.omitEmail) claims["email"] = o.email ?? email(uid.slice(4, 12));
  return new SignJWT(claims)
    .setProtectedHeader({ alg: (o.alg ?? "RS256") as "RS256", kid: "k1" })
    .setSubject(uid)
    .setIssuer(o.iss ?? `https://securetoken.google.com/${PROJECT}`)
    .setAudience(o.aud ?? PROJECT)
    .setIssuedAt()
    .setExpirationTime(o.exp ?? "1h")
    .sign(o.key ?? priv);
}

const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, tok?: string, body?: object, extra: Record<string, string> = {}) =>
  app.inject({ method, url, headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...extra }, ...(body ? { payload: body } : {}) });

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  priv = kp.privateKey;
  other = (await generateKeyPair("RS256")).privateKey;
  const jwk: JWK = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  handle = createDb(inject("dbUrl"));
  app = await buildApp({
    db: handle.db,
    authenticate: failClosedAuthenticator,
    firebase: { verifier: createFirebaseVerifier({ projectId: PROJECT, keys: createLocalJWKSet({ keys: [jwk] }) }), publicConfig: { apiKey: "public-web-key", authDomain: `${PROJECT}.firebaseapp.com`, projectId: PROJECT, appId: "1:1:web:1" } },
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await handle.close();
});

describe("Firebase sign-in: public configuration", () => {
  it("serves the public web config without authentication and never caches it", async () => {
    const res = await call("GET", "/api/v1/auth/config");
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json().data).toEqual({ devAuth: false, firebase: { apiKey: "public-web-key", authDomain: `${PROJECT}.firebaseapp.com`, projectId: PROJECT, appId: "1:1:web:1" } });
  });
});

describe("Firebase sign-in: token verification", () => {
  it("rejects missing, malformed and forged tokens", async () => {
    expect((await call("GET", "/api/v1/me")).statusCode).toBe(401);
    expect((await call("GET", "/api/v1/me", "not-a-jwt")).statusCode).toBe(401);
    expect((await call("GET", "/api/v1/me", await token({ aud: "someone-else" }))).statusCode).toBe(401);
    expect((await call("GET", "/api/v1/me", await token({ iss: "https://securetoken.google.com/someone-else" }))).statusCode).toBe(401);
    expect((await call("GET", "/api/v1/me", await token({ exp: Math.floor(Date.now() / 1000) - 3600 }))).statusCode).toBe(401);
    expect((await call("GET", "/api/v1/me", await token({ key: other }))).statusCode).toBe(401); // signed by a key we do not trust
    expect((await call("GET", "/api/v1/me", await token({ omitEmail: true }))).statusCode).toBe(401);
  });

  it("rejects an unsigned (alg none) token and an HS256 token signed with a guessed secret", async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const claims = { sub: "x", email: email("none"), email_verified: true, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, exp: Math.floor(Date.now() / 1000) + 600 };
    const none = `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.`;
    expect((await call("GET", "/api/v1/me", none)).statusCode).toBe(401);
    const hs = await new SignJWT({ email: email("hs"), email_verified: true }).setProtectedHeader({ alg: "HS256" }).setSubject("x").setIssuer(claims.iss).setAudience(PROJECT).setExpirationTime("1h").sign(new TextEncoder().encode("a".repeat(32)));
    expect((await call("GET", "/api/v1/me", hs)).statusCode).toBe(401);
  });

  it("does not let development headers stand in for a person", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/agents", headers: { "x-dev-actor-id": randomUUID(), "x-dev-org-id": randomUUID(), "x-dev-role": "admin" } });
    expect(res.statusCode).toBe(401);
  });
});

describe("Firebase sign-in: people and organizations", () => {
  it("creates the user on first sight, keeps the same actor id, and reports no organizations yet", async () => {
    const t = await token({ uid: `uid-${randomUUID()}`, email: email("first") });
    const a = await call("GET", "/api/v1/me", t);
    expect(a.statusCode).toBe(200);
    expect(a.json().data.memberships).toEqual([]);
    expect(a.json().data.user.emailVerified).toBe(true);
    const b = await call("GET", "/api/v1/me", t);
    expect(b.json().data.user.id).toBe(a.json().data.user.id);
    // a person without an organization has no access to organization data
    expect((await call("GET", "/api/v1/agents", t)).statusCode).toBe(401);
  });

  it("an unverified email can see /me but cannot create an organization or reach organization data", async () => {
    const t = await token({ email: email("unverified"), verified: false });
    const me = await call("GET", "/api/v1/me", t);
    expect(me.statusCode).toBe(200);
    expect(me.json().data.user.emailVerified).toBe(false);
    expect(me.json().data.memberships).toEqual([]);
    expect((await call("POST", "/api/v1/me/organizations", t, { name: "Nope Inc" })).statusCode).toBe(403);
    expect((await call("GET", "/api/v1/agents", t)).statusCode).toBe(401);
  });

  it("a verified person creates an organization, becomes its admin, and the starter plan is not negotiable", async () => {
    const t = await token({ email: email("founder") });
    const bad = await call("POST", "/api/v1/me/organizations", t, { name: "Acme Security", tier: "enterprise" });
    expect(bad.statusCode).toBe(400);
    const res = await call("POST", "/api/v1/me/organizations", t, { name: "Acme Security" });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ name: "Acme Security", role: "admin", tier: "starter" });
    expect(res.json().data.slug).toMatch(/^acme-security/);

    const agents = await call("GET", "/api/v1/agents", t);
    expect(agents.statusCode).toBe(200);
    const org = await call("GET", "/api/v1/saas/organizations/current", t);
    expect(org.json().data.id).toBe(res.json().data.organizationId);
  });

  it("two organizations with the same name get distinct slugs", async () => {
    const a = await call("POST", "/api/v1/me/organizations", await token({ email: email("dup1") }), { name: `Same Name ${run}` });
    const b = await call("POST", "/api/v1/me/organizations", await token({ email: email("dup2") }), { name: `Same Name ${run}` });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(a.json().data.slug).not.toBe(b.json().data.slug);
  });

  it("limits how many organizations one person can administer", async () => {
    const t = await token({ email: email("many") });
    for (let i = 0; i < MAX_ADMIN_ORGANIZATIONS; i++) expect((await call("POST", "/api/v1/me/organizations", t, { name: `Many ${i} ${run}` })).statusCode).toBe(201);
    const over = await call("POST", "/api/v1/me/organizations", t, { name: `Many over ${run}` });
    expect(over.statusCode).toBe(409);
    expect(over.json().error.code).toBe("ORGANIZATION_LIMIT");
  });

  it("an organization is chosen by header, and only among the person's own active memberships", async () => {
    const t = await token({ email: email("multi") });
    const o1 = (await call("POST", "/api/v1/me/organizations", t, { name: `Multi A ${run}` })).json().data.organizationId as string;
    const o2 = (await call("POST", "/api/v1/me/organizations", t, { name: `Multi B ${run}` })).json().data.organizationId as string;
    expect((await call("GET", "/api/v1/saas/organizations/current", t)).json().data.id).toBe(o1); // oldest by default
    expect((await call("GET", "/api/v1/saas/organizations/current", t, undefined, { "x-corven-org-id": o2 })).json().data.id).toBe(o2);
    const stranger = (await call("POST", "/api/v1/me/organizations", await token({ email: email("stranger") }), { name: `Stranger ${run}` })).json().data.organizationId as string;
    expect((await call("GET", "/api/v1/saas/organizations/current", t, undefined, { "x-corven-org-id": stranger })).statusCode).toBe(401);
    expect((await call("GET", "/api/v1/saas/organizations/current", t, undefined, { "x-corven-org-id": "not-a-uuid" })).statusCode).toBe(401);
  });

  it("an invitation grants nothing until the invited person accepts it, then exactly the invited role", async () => {
    const admin = await token({ email: email("owner") });
    const org = (await call("POST", "/api/v1/me/organizations", admin, { name: `Invite Co ${run}`, website: "https://invite.example" })).json().data.organizationId as string;
    const invitee = email("Viewer");
    const inv = await call("POST", "/api/v1/saas/organizations/members", admin, { email: invitee, role: "viewer" });
    expect(inv.statusCode).toBe(201);
    expect(inv.json().data.status).toBe("invited");

    const uid = `uid-${randomUUID()}`;
    // The same address, unverified, must not see or claim the invitation.
    const unverified = await token({ uid, email: invitee.toUpperCase(), verified: false });
    expect((await call("GET", "/api/v1/me", unverified)).json().data.invitations).toEqual([]);
    expect((await call("POST", `/api/v1/me/invitations/${inv.json().data.id}/accept`, unverified)).statusCode).toBe(403);

    const v = await token({ uid, email: invitee.toUpperCase(), verified: true });
    const me = (await call("GET", "/api/v1/me", v)).json().data;
    expect(me.memberships).toEqual([]);
    expect(me.invitations).toHaveLength(1);
    expect(me.invitations[0]).toMatchObject({ organizationId: org, organizationName: `Invite Co ${run}`, role: "viewer" });
    expect((await call("GET", "/api/v1/agents", v)).statusCode).toBe(401); // not yet

    // someone else cannot accept it on their behalf
    const stranger = await token({ email: email("stranger2") });
    expect((await call("POST", `/api/v1/me/invitations/${me.invitations[0].id}/accept`, stranger)).statusCode).toBe(404);

    expect((await call("POST", `/api/v1/me/invitations/${me.invitations[0].id}/accept`, v)).statusCode).toBe(200);
    const after = (await call("GET", "/api/v1/me", v)).json().data;
    expect(after.invitations).toEqual([]);
    expect(after.memberships[0]).toMatchObject({ organizationId: org, role: "viewer" });
    expect((await call("GET", "/api/v1/agents", v)).statusCode).toBe(200);
    // viewers cannot administer: updating the organization is admin-only
    expect((await call("PATCH", "/api/v1/saas/organizations/current", v, { name: "Hijacked" })).statusCode).toBe(403);
    // accepting twice is not possible
    expect((await call("POST", `/api/v1/me/invitations/${me.invitations[0].id}/accept`, v)).statusCode).toBe(404);
    // the website given at creation is kept in the organization's settings
    expect((await call("GET", "/api/v1/saas/organizations/current", admin)).json().data.settings).toEqual({ website: "https://invite.example" });
  });

  it("a declined invitation disappears and grants nothing", async () => {
    const admin = await token({ email: email("decliner-owner") });
    await call("POST", "/api/v1/me/organizations", admin, { name: `Decline Co ${run}` });
    const who = email("decliner");
    await call("POST", "/api/v1/saas/organizations/members", admin, { email: who, role: "operator" });
    const t = await token({ email: who });
    const id = (await call("GET", "/api/v1/me", t)).json().data.invitations[0].id as string;
    expect((await call("POST", `/api/v1/me/invitations/${id}/decline`, t)).statusCode).toBe(200);
    const me = (await call("GET", "/api/v1/me", t)).json().data;
    expect(me.invitations).toEqual([]);
    expect(me.memberships).toEqual([]);
    expect((await call("GET", "/api/v1/agents", t)).statusCode).toBe(401);
  });

  it("rejects a website that is not an http(s) URL", async () => {
    const t = await token({ email: email("site") });
    expect((await call("POST", "/api/v1/me/organizations", t, { name: "Site Co", website: "javascript:alert(1)" })).statusCode).toBe(400);
  });

  it("removing a member cuts access on the very next request", async () => {
    const admin = await token({ email: email("boss") });
    await call("POST", "/api/v1/me/organizations", admin, { name: `Revoke Co ${run}` });
    const member = email("leaver");
    const created = (await call("POST", "/api/v1/saas/organizations/members", admin, { email: member, role: "operator" })).json().data.id as string;
    const t = await token({ email: member });
    expect((await call("POST", `/api/v1/me/invitations/${created}/accept`, t)).statusCode).toBe(200);
    expect((await call("GET", "/api/v1/agents", t)).statusCode).toBe(200);
    expect((await call("DELETE", `/api/v1/saas/organizations/members/${created}`, admin)).statusCode).toBe(200);
    expect((await call("GET", "/api/v1/agents", t)).statusCode).toBe(401);
  });
});

describe("slugify", () => {
  it("produces url-safe slugs and never an empty one", () => {
    expect(slugify("Acme  Security, Inc.")).toBe("acme-security-inc");
    expect(slugify("  ---  ")).toBe("org");
    expect(slugify("Ünïcode Çorp")).toBe("unicode-corp");
    expect(slugify("x".repeat(200)).length).toBeLessThanOrEqual(48);
  });
});
