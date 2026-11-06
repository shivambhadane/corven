import type { FastifyInstance } from "fastify";
import type { Authenticator } from "../../auth/principal.js";
import type { Database } from "../../db/client.js";
import { ApiKeyRepository } from "./api-keys/api-key.repository.js";
import { apiKeyRoutes } from "./api-keys/api-key.routes.js";
import { ApiKeyService } from "./api-keys/api-key.service.js";
import { AwsIamConnector } from "./connectors/aws-iam.connector.js";
import { GitHubConnector } from "./connectors/github.connector.js";
import { SlackConnector } from "./connectors/slack.connector.js";
import { OrganizationRepository } from "./organizations/organization.repository.js";
import { organizationRoutes } from "./organizations/organization.routes.js";
import { OrganizationService } from "./organizations/organization.service.js";
import { QuotaEnforcer } from "./quotas/quota.enforcer.js";
import { WebhookDispatcher } from "./webhooks/webhook.dispatcher.js";
import { WebhookRepository } from "./webhooks/webhook.repository.js";
import { webhookRoutes } from "./webhooks/webhook.routes.js";
import { WebhookService } from "./webhooks/webhook.service.js";

export function createSaasModule(db: Database, options?: { customFetch?: typeof fetch }) {
  const apiKeyRepo = new ApiKeyRepository();
  const apiKeys = new ApiKeyService(db, apiKeyRepo);
  const orgRepo = new OrganizationRepository();
  const organizations = new OrganizationService(db, orgRepo);
  const webhookRepo = new WebhookRepository();
  const webhooks = new WebhookService(db, webhookRepo);
  const dispatcher = new WebhookDispatcher(db, webhookRepo, options?.customFetch);
  const quotas = new QuotaEnforcer();
  const awsIam = new AwsIamConnector();
  const github = new GitHubConnector();
  const slack = new SlackConnector();

  return {
    apiKeyRepo,
    apiKeys,
    orgRepo,
    organizations,
    webhookRepo,
    webhooks,
    dispatcher,
    quotas,
    connectors: {
      awsIam,
      github,
      slack,
    },
  };
}

export type SaasModule = ReturnType<typeof createSaasModule>;

export async function registerSaasRoutes(app: FastifyInstance, saas: SaasModule) {
  await app.register(organizationRoutes, { prefix: "/api/v1/saas/organizations", organizations: saas.organizations });
  await app.register(apiKeyRoutes, { prefix: "/api/v1/saas/api-keys", apiKeys: saas.apiKeys });
  await app.register(webhookRoutes, { prefix: "/api/v1/saas/webhooks", webhooks: saas.webhooks });
}

export function createApiKeyAuthenticator(apiKeys: ApiKeyService, fallback?: Authenticator): Authenticator {
  return async (headers) => {
    // Check Authorization: Bearer crv_live_...
    const authHeader = headers["authorization"] || headers["Authorization"];
    const authVal = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (authVal?.startsWith("Bearer crv_live_")) {
      const rawKey = authVal.slice(7).trim();
      const principal = await apiKeys.authenticateRawKey(rawKey);
      if (principal) return principal;
    }

    // Check x-api-key: crv_live_...
    const apiKeyHeader = headers["x-api-key"] || headers["X-Api-Key"];
    const apiKeyVal = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
    if (apiKeyVal?.startsWith("crv_live_")) {
      const principal = await apiKeys.authenticateRawKey(apiKeyVal.trim());
      if (principal) return principal;
    }

    if (fallback) {
      return await fallback(headers);
    }
    return null;
  };
}

export * from "./api-keys/api-key.types.js";
export * from "./organizations/organization.types.js";
export * from "./webhooks/webhook.types.js";
export * from "./quotas/quota.types.js";
export * from "./connectors/aws-iam.connector.js";
export * from "./connectors/github.connector.js";
export * from "./connectors/slack.connector.js";
