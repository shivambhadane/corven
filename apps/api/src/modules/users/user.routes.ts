import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import type { UserRecord } from "./user.repository.js";
import type { UserService } from "./user.service.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set only on `auth: "user"` routes: the verified person, who may not belong to any organization yet. */
    user: UserRecord;
  }
}

/** Public, non-secret client configuration. The Firebase web config is identification, not a credential. */
export interface PublicAuthConfig {
  devAuth: boolean;
  firebase: { apiKey: string; authDomain: string; projectId: string; appId: string } | null;
}

export interface UserRoutesOptions {
  users: UserService;
  config: PublicAuthConfig;
}

const CreateOrgBody = Type.Object(
  { name: Type.String({ minLength: 2, maxLength: 80, pattern: "\\S" }), website: Type.Optional(Type.String({ maxLength: 200, pattern: "^https?://[^\\s]+$" })) },
  { additionalProperties: false },
);
const InvitationParams = Type.Object({ id: Type.String({ format: "uuid" }) }, { additionalProperties: false });

export const userRoutes: FastifyPluginAsyncTypebox<UserRoutesOptions> = async (app, { users, config }) => {
  app.get("/auth/config", { config: { auth: "public" } }, async (_req, reply) => {
    void reply.header("cache-control", "no-store");
    return { data: config };
  });

  app.get("/me", { config: { auth: "user" } }, async (req, reply) => {
    void reply.header("cache-control", "no-store");
    const u = req.user;
    const memberships = await users.memberships(u);
    const invitations = await users.invitations(u);
    return {
      data: {
        user: { id: u.id, email: u.email, emailVerified: u.emailVerified, displayName: u.displayName },
        memberships: memberships.map((m) => ({ organizationId: m.organizationId, name: m.organizationName, slug: m.slug, tier: m.tier, role: m.role })),
        invitations: invitations.map((i) => ({ id: i.invitationId, organizationId: i.organizationId, organizationName: i.organizationName, role: i.role, invitedAt: i.invitedAt.toISOString() })),
      },
    };
  });

  app.post("/me/organizations", { config: { auth: "user" }, schema: { body: CreateOrgBody } }, async (req, reply) => {
    const m = await users.createOrganization(req.user, req.body.name.trim(), req.body.website);
    return reply.code(201).send({ data: { organizationId: m.organizationId, name: m.organizationName, slug: m.slug, tier: m.tier, role: m.role } });
  });

  app.post("/me/invitations/:id/accept", { config: { auth: "user" }, schema: { params: InvitationParams } }, async (req) => {
    await users.respondToInvitation(req.user, req.params.id, true);
    return { data: { accepted: true } };
  });

  app.post("/me/invitations/:id/decline", { config: { auth: "user" }, schema: { params: InvitationParams } }, async (req) => {
    await users.respondToInvitation(req.user, req.params.id, false);
    return { data: { declined: true } };
  });
};
