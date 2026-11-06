# CORVEN operator console

React + Vite single-page app, served by the API at `/console/` (one origin with the landing page at `/`). The landing page's **Console** and **Login** links open it.

| Page | What it does (all through the real API) |
|---|---|
| Overview | Counts, Arkiv anchoring stats and a live Rabdi check (admin); **Load demo network** (admin) and **Simulate a compromise** |
| Incidents | List, filter, report an incident |
| Incident | Automated response (start / run / retry), lifecycle transitions, analysis (snapshot, blast radius, plan), approvals, verification runs and checks, evidence (generate, verify, anchor on Arkiv), timeline |
| Approvals | Approve or reject the exact plan (approver, admin) |
| Agents / Graph / Gateway | Registry, dependency graph, enforcement coverage and grants |

**Sign-in is development-only**: you choose an organization id and a role, and the API trusts them only when it runs with `CORVEN_DEV_AUTH=1` (which `run.sh` sets locally). Real authentication is not built. Switch roles in the sidebar to act as operator, approver or admin.

```bash
./run.sh        # build and serve everything on http://127.0.0.1:3001
./run.sh dev    # Vite on http://127.0.0.1:5173/console/ with the API on :3001
```
