export interface SlackIncidentAlert {
  incidentId: string;
  workflowId: string;
  seedAgentId: string;
  blastRadiusSize: number;
  containmentActionsCount: number;
  consoleUrl: string;
}

export interface SlackBlockKitMessage {
  text: string;
  blocks: Array<Record<string, unknown>>;
}

export class SlackConnector {
  /**
   * Builds an interactive Slack Block Kit message for incident containment approval.
   */
  buildApprovalMessage(alert: SlackIncidentAlert): SlackBlockKitMessage {
    const text = `🚨 *CORVEN Incident Alert*: Containment approval required for incident \`${alert.incidentId}\``;

    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🚨 Autonomous Incident Containment Required",
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Incident ID:*\n\`${alert.incidentId}\``,
          },
          {
            type: "mrkdwn",
            text: `*Compromised Seed Agent:*\n\`${alert.seedAgentId}\``,
          },
          {
            type: "mrkdwn",
            text: `*Blast Radius Nodes:*\n*${alert.blastRadiusSize}* agents & resources`,
          },
          {
            type: "mrkdwn",
            text: `*Proposed Actions:*\n*${alert.containmentActionsCount}* boundary isolation steps`,
          },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Review in Console",
              emoji: true,
            },
            url: alert.consoleUrl,
            style: "primary",
          },
        ],
      },
    ];

    return { text, blocks };
  }

  /**
   * Dispatches the Block Kit payload to a Slack incoming webhook URL.
   */
  async sendAlert(
    webhookUrl: string,
    alert: SlackIncidentAlert,
    fetchFn: typeof fetch = globalThis.fetch,
  ): Promise<{ success: boolean; statusCode: number }> {
    const payload = this.buildApprovalMessage(alert);
    const res = await fetchFn(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    return {
      success: res.ok,
      statusCode: res.status,
    };
  }
}
