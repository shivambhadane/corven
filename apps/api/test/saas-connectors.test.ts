import { describe, expect, it } from "vitest";
import { AwsIamConnector } from "../src/modules/saas/connectors/aws-iam.connector.js";
import { GitHubConnector } from "../src/modules/saas/connectors/github.connector.js";
import { SlackConnector } from "../src/modules/saas/connectors/slack.connector.js";

describe("SaaS: Cloud Enforcement Connectors", () => {
  describe("AwsIamConnector", () => {
    const connector = new AwsIamConnector();

    it("generates quarantine policy and cryptographic proof for valid IAM role", async () => {
      const roleArn = "arn:aws:iam::123456789012:role/FinancialTradingAgentRole";
      const result = await connector.quarantineRole({
        roleArn,
        reason: "Compromised LLM tool execution detected",
      });

      expect(result.connector).toBe("aws-iam");
      expect(result.targetArn).toBe(roleArn);
      expect(result.action).toBe("quarantine_policy_attached");
      expect(result.policyName).toBe("CorvenIncidentQuarantinePolicy");
      expect(result.sessionsRevokedBefore).toBeDefined();
      expect(result.proofHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("rejects invalid AWS ARN syntax", async () => {
      await expect(
        connector.quarantineRole({
          roleArn: "not-an-arn",
          reason: "testing",
        }),
      ).rejects.toThrow(/Invalid AWS IAM ARN/);
    });
  });

  describe("GitHubConnector", () => {
    const connector = new GitHubConnector();

    it("generates revocation record and proof for GitHub App installation token", async () => {
      const result = await connector.revokeInstallationToken({
        installationId: 9876543,
        repository: "corven-ai/infra-automation",
        reason: "Unauthorized privilege escalation in CI workflow",
      });

      expect(result.connector).toBe("github");
      expect(result.installationId).toBe(9876543);
      expect(result.repository).toBe("corven-ai/infra-automation");
      expect(result.action).toBe("installation_token_revoked");
      expect(result.proofHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("rejects non-positive installation IDs", async () => {
      await expect(
        connector.revokeInstallationToken({
          installationId: -1,
          reason: "test",
        }),
      ).rejects.toThrow(/Invalid GitHub installation ID/);
    });
  });

  describe("SlackConnector", () => {
    const connector = new SlackConnector();

    it("builds rich Block Kit containment approval card", () => {
      const msg = connector.buildApprovalMessage({
        incidentId: "inc-5555",
        workflowId: "wf-7777",
        seedAgentId: "agent-trade-bot",
        blastRadiusSize: 7,
        containmentActionsCount: 3,
        consoleUrl: "https://console.corven.ai/incidents/inc-5555",
      });

      expect(msg.text).toContain("inc-5555");
      expect(msg.blocks.length).toBeGreaterThanOrEqual(3);
      const headerBlock = msg.blocks[0] as { text: { text: string } };
      expect(headerBlock.text.text).toContain("Autonomous Incident Containment");

      const actionBlock = msg.blocks[2] as { elements: Array<{ url: string }> };
      expect(actionBlock.elements[0]!.url).toBe("https://console.corven.ai/incidents/inc-5555");
    });

    it("sends Block Kit alert via mock fetch", async () => {
      let sentBody: string | undefined;
      const mockFetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
        sentBody = init?.body as string;
        return { ok: true, status: 200 } as Response;
      }) as typeof fetch;

      const res = await connector.sendAlert(
        "https://hooks.slack.com/services/T00/B00/X00",
        {
          incidentId: "inc-1",
          workflowId: "wf-1",
          seedAgentId: "agent-1",
          blastRadiusSize: 2,
          containmentActionsCount: 1,
          consoleUrl: "https://console.corven.ai/incidents/inc-1",
        },
        mockFetch,
      );

      expect(res.success).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(sentBody).toContain("inc-1");
    });
  });
});
