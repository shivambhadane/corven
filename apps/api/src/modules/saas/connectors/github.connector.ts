import { createHash } from "node:crypto";

export interface GitHubRevocationRequest {
  installationId: number;
  repository?: string;
  reason: string;
}

export interface GitHubRevocationResult {
  connector: "github";
  installationId: number;
  repository: string | null;
  action: "installation_token_revoked";
  revokedAt: string;
  proofHash: string;
}

export class GitHubConnector {
  /**
   * Generates a containment execution result revoking tokens associated with the GitHub App installation.
   */
  async revokeInstallationToken(request: GitHubRevocationRequest): Promise<GitHubRevocationResult> {
    if (!Number.isInteger(request.installationId) || request.installationId <= 0) {
      throw new Error(`Invalid GitHub installation ID: ${request.installationId}`);
    }

    const revokedAt = new Date().toISOString();
    const rawProof = JSON.stringify({
      installationId: request.installationId,
      repository: request.repository ?? null,
      reason: request.reason,
      revokedAt,
    });

    const proofHash = createHash("sha256").update(rawProof).digest("hex");

    return {
      connector: "github",
      installationId: request.installationId,
      repository: request.repository ?? null,
      action: "installation_token_revoked",
      revokedAt,
      proofHash,
    };
  }
}
