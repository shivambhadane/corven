# Approval policies

One policy per organization (`PUT /approval-policy`, administrators). Without one, the default applies:

| Field | Default | Range | Meaning |
|---|---|---|---|
| `requiredApprovals` | 1 | 1-5 | Distinct approvers needed for a standard plan |
| `elevatedRequiredApprovals` | 2 | requiredApprovals-5 | Needed for an elevated-risk plan |
| `separationOfDuties` | true | | The requester cannot approve their own request |
| `expiryMinutes` | 60 | 5-10080 | A pending request expires after this |
| `executionWindowMinutes` | 60 | 5-1440 | An approved plan can be executed only within this time |

## Risk

A plan is **elevated** when the Containment Engine flagged it for approval (`approvalRequired` or any `approvalReasons`: affects a healthy agent, uncertain dependencies, high-value target, cost threshold, uncertain dependencies in the attack region). Otherwise it is **standard**. The reasons are copied onto the request.

## Rules

- Each person counts once (`ALREADY_DECIDED`). Any single rejection ends the request.
- A request copies the policy in force when it was created; later policy changes do not affect it (tested).
- Every policy change is audited with before and after.

Deliberately not built: per-action-type policies, quorum by role, delegation of approval authority, and approval through external channels.
