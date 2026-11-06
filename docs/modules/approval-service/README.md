# Approval Service

**Status: implemented and tested.** Code: `apps/api/src/modules/approval-service`. Human authentication is still the development header adapter, so "who approved" is only as trustworthy as that adapter until real authentication exists.

## Purpose

Make sure a containment plan is executed only after authorized people approved **that exact plan**. The service binds each request to the plan by hash, enforces the organization's policy (number of approvers, separation of duties, expiry, execution window), records every decision, moves the incident through its lifecycle, and answers the Enforcement Gateway's question "is this plan approved?".

## What it does not do

It does not execute anything (the gateway does), does not authenticate people (the platform authenticator does), and never trusts the browser: every check is on the server.

## Documents

| Document | Contents |
|---|---|
| [architecture.md](architecture.md) | Components, workflow, incident synchronisation and recovery |
| [plan-integrity.md](plan-integrity.md) | The approval digest and every point where the plan is re-verified |
| [approval-policies.md](approval-policies.md) | Policy fields, risk, separation of duties, expiry |
| [data-model.md](data-model.md) | Tables and guards |
| [api.md](api.md) | Endpoints, roles and errors |
| [testing.md](testing.md) | Tests and results |

## Roles

A new role, `approver` (the brief's Incident Approver), can read and decide approvals and nothing else. `admin` can request, decide, cancel and set the policy. `operator` can request and cancel their own requests but never decide. `viewer` reads. The brief's Organization Owner and Security Engineer roles do not exist yet; they arrive with real identity and membership.
