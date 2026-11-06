# Production Cloud Enforcement Connectors

## 1. Overview

CORVEN enforces containment by executing targeted revocations at real customer enforcement points. Connectors translate high-level containment actions (`revoke_credential`, `detach_policy`, `pause_contract`) into cloud-specific API executions.

---

## 2. AWS IAM Connector (`AwsIamConnector`)

For AWS environments where AI agents execute under IAM Roles or access S3/DynamoDB/Bedrock:

### Security & Delegation Model:
- **Cross-Account Role Delegation**: CORVEN assumes a customer IAM Role using an external ID:
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": { "AWS": "arn:aws:iam::CORVEN_ACCOUNT_ID:root" },
        "Action": "sts:AssumeRole",
        "Condition": { "StringEquals": { "sts:ExternalId": "CUSTOMER_ORG_EXTERNAL_ID" } }
      }
    ]
  }
  ```
- **Containment Actions**:
  1. `detach_role_policy`: Detaches specific managed policies granting access to the protected resource.
  2. `revoke_active_sessions`: Issues an inline `AWSRevokeOlderSessions` policy setting `aws:TokenIssueTime` before the containment timestamp, immediately invalidating active STS tokens.
  3. `deactivate_access_key`: Deactivates compromised IAM access keys.

---

## 3. GitHub App Connector (`GitHubTokenConnector`)

For coding agents and automated PR reviewers:

- **Enforcement Actions**:
  1. `revoke_installation_token`: Revokes the active bearer token used by the agent.
  2. `suspend_app_installation`: Temporarily halts the agent's GitHub App installation across repositories during an active incident.

---

## 4. Slack Connector (`SlackAlertConnector`)

For interactive human-in-the-loop approvals:

- Dispatches rich Slack Block Kit notifications to designated security triage channels.
- Displays the **Cryptographic Plan Digest**, number of revocations, and preserved healthy workflows.
- Contains interactive **"Approve Containment"** and **"Reject"** buttons routed back to CORVEN’s Approval Service with authenticated user identity.
