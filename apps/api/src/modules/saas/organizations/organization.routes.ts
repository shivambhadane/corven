import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
  CreateOrganizationBody,
  InviteMemberBody,
  MemberParams,
  UpdateOrganizationBody,
  responses,
} from "./organization.schema.js";
import type { OrganizationService } from "./organization.service.js";

export interface OrganizationRoutesOptions {
  organizations: OrganizationService;
}

export const organizationRoutes: FastifyPluginAsyncTypebox<OrganizationRoutesOptions> = async (app, { organizations }) => {
  // Public or initial creation
  app.post("/", { schema: { body: CreateOrganizationBody, response: responses.orgCreated } }, async (req, reply) => {
    // If not authenticated yet, we can use a generated actor ID or fallback email
    const actorId = req.principal?.actorId ?? "00000000-0000-0000-0000-000000000001";
    const actorEmail = "admin@" + (req.body as { slug: string }).slug + ".internal";
    const org = await organizations.createOrganization(actorId, actorEmail, req.body as never);
    return reply.code(201).send({ data: org });
  });

  // Current organization details
  app.get("/current", { schema: { response: responses.org } }, async (req) => {
    const org = await organizations.getOrganization(req.principal);
    return { data: org };
  });

  app.patch("/current", { schema: { body: UpdateOrganizationBody, response: responses.org } }, async (req) => {
    const org = await organizations.updateOrganization(req.principal, req.body as never);
    return { data: org };
  });

  // Organization members
  app.get("/members", { schema: { response: responses.memberList } }, async (req) => {
    const members = await organizations.listMembers(req.principal);
    return { data: members };
  });

  app.post("/members", { schema: { body: InviteMemberBody, response: responses.memberCreated } }, async (req, reply) => {
    const member = await organizations.inviteMember(req.principal, req.body as never);
    return reply.code(201).send({ data: member });
  });

  app.delete("/members/:memberId", { schema: { params: MemberParams, response: responses.memberItem } }, async (req) => {
    const member = await organizations.removeMember(req.principal, req.params.memberId);
    return { data: member };
  });
};
