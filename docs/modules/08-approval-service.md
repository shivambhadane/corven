# Approval Service (index)

**Status: implemented and tested.** Documentation: [approval-service/](approval-service/README.md).

Approval requests are bound to one exact containment plan by a schema-versioned digest (plan hash, snapshot hash, result hash). The plan is recomputed from its pinned snapshot when a request is made, on every decision, and whenever the gateway asks whether it may execute. Policies set the number of distinct approvers (more for elevated-risk plans), separation of duties, expiry and an execution window. A new `approver` role can decide but change nothing else. Decisions update the incident lifecycle and timeline idempotently, with a maintenance sweep for expiry and recovery.

Not built: real human identity (development authenticator), approver notifications, signed approvals, and scheduling of the sweep (orchestration stage).
