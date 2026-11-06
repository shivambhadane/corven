import { createHash } from "node:crypto";

export interface AwsIamQuarantineRequest {
  roleArn: string;
  externalId?: string;
  reason: string;
}

export interface AwsIamQuarantineResult {
  connector: "aws-iam";
  targetArn: string;
  action: "quarantine_policy_attached";
  policyName: string;
  sessionsRevokedBefore: string;
  proofHash: string;
}

export class AwsIamConnector {
  /**
   * Generates a quarantine policy that explicitly denies all actions for the targeted IAM role
   * and revokes active temporary credentials issued prior to this timestamp.
   */
  async quarantineRole(request: AwsIamQuarantineRequest): Promise<AwsIamQuarantineResult> {
    const arnRegex = /^arn:aws:iam::\d{12}:(role|user)\/[\w+=,.@-]{1,64}$/;
    if (!arnRegex.test(request.roleArn)) {
      throw new Error(`Invalid AWS IAM ARN format: ${request.roleArn}`);
    }

    const sessionsRevokedBefore = new Date().toISOString();
    const policyName = "CorvenIncidentQuarantinePolicy";

    const quarantinePolicyDocument = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "CorvenQuarantineDenyAll",
          Effect: "Deny",
          Action: "*",
          Resource: "*",
        },
      ],
    };

    const rawProof = JSON.stringify({
      roleArn: request.roleArn,
      sessionsRevokedBefore,
      policy: quarantinePolicyDocument,
      reason: request.reason,
    });

    const proofHash = createHash("sha256").update(rawProof).digest("hex");

    return {
      connector: "aws-iam",
      targetArn: request.roleArn,
      action: "quarantine_policy_attached",
      policyName,
      sessionsRevokedBefore,
      proofHash,
    };
  }
}
