export const API_KEY_SCOPES = [
  "agents:read",
  "agents:write",
  "incidents:read",
  "incidents:write",
  "containment:execute",
  "approvals:write",
  "webhooks:manage",
  "*",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export interface ApiKeyRecord {
  id: string;
  organizationId: string;
  name: string;
  prefix: string;
  keyHash: string;
  scopes: ApiKeyScope[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdBy: string;
  createdAt: Date;
}

export interface CreateApiKeyInput {
  name: string;
  scopes?: ApiKeyScope[];
  expiresInDays?: number;
}

export interface ApiKeyDto {
  id: string;
  organizationId: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface CreatedApiKeyDto extends ApiKeyDto {
  rawKey: string;
}
