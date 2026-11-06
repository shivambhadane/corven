# Human authentication (Firebase)

**Status:** built and tested against locally signed test tokens. Not yet exercised against a real Firebase project; that needs the setup below.

Machine identity is separate (API keys `crv_live_...`, agent tokens `cvn_...`). This page is about people using the web app.

## Design

```text
Browser                         API                                   PostgreSQL
  | sign in with Firebase        |                                          |
  | (Google or email/password)   |                                          |
  |--- Authorization: Bearer <Firebase ID token> ------------------------->  |
  |                              | verify RS256 signature, issuer, audience, |
  |                              | expiry against Google's public keys       |
  |                              | find/create `users` row (by uid)          |
  |                              | memberships = organization_members        |
  |                              |   where email = verified email, active  --|
  |                              | principal = { user id, organization,      |
  |                              |               role from the member row }  |
```

- **The token proves who you are; CORVEN decides what you may do.** Organization and role come from `organization_members`, never from the token or the request body.
- **Verified email only.** Access and invitations match on a *verified* email. An unverified password sign-up can see `/me` and nothing else; it cannot create an organization or claim an invitation.
- **Access is checked on every request.** Removing a member removes access on their next request; there is no session to expire.
- **Several organizations.** The browser sends `x-corven-org-id`; it is honoured only if the person is an active member of that organization.
- **No secrets on the server.** Verification uses Google's published public keys (`securetoken@system.gserviceaccount.com`), so no service account is needed. `FIREBASE_*` values are public identifiers.
- The `users` table (migration 0024) maps a Firebase uid to a CORVEN actor id, which is what appears in audit rows.

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/v1/auth/config` | public | Firebase web config and whether development sign-in is on (for the browser) |
| `GET /api/v1/me` | signed-in person | Who you are and your organizations. Works before you belong to one |
| `POST /api/v1/me/organizations` | signed-in, verified | Create your first (or another) organization (name, optional website); you become its admin on the starter plan |
| `POST /api/v1/me/invitations/:id/accept` | signed-in, verified | Accept an invitation addressed to your verified email; access starts now |
| `POST /api/v1/me/invitations/:id/decline` | signed-in, verified | Decline it; the invitation is removed |

## Policy decisions (change deliberately)

- Any verified person may create an organization, capped at **3 organizations administered per person** (`MAX_ADMIN_ORGANIZATIONS` in `user.service.ts`). The plan is always `starter`; the caller cannot choose it.
- Invitations are by email. An admin invites a member by email (`POST /api/v1/saas/organizations/members`), which creates an *invited* membership. It grants nothing until that person signs in with that verified address and accepts it. `/me` lists pending invitations; the onboarding page shows them before offering to create a separate workspace.
- Rate limiting and lockout are Firebase's (for sign-in) and not yet CORVEN's (for the API). See known limitations.

## Setting it up

1. Create a Firebase project (or use an existing one), add a **Web app**, and copy its config.
2. **Authentication > Sign-in method:** enable **Google** and **Email/Password**.
3. **Authentication > Settings > Authorized domains:** add the host you serve CORVEN from. `localhost` is there by default.
4. Put these in `.env` (public values, not secrets) and restart:

   ```text
   FIREBASE_PROJECT_ID=...
   FIREBASE_WEB_API_KEY=...
   FIREBASE_APP_ID=...
   FIREBASE_AUTH_DOMAIN=...      # optional; defaults to <project>.firebaseapp.com
   ```
5. Run `./run.sh` and open http://localhost:3000/signup (use `localhost`, not `127.0.0.1`: only `localhost` is an authorized domain by default). The first person to sign up creates an organization and becomes its admin.

The website is the Next.js app in `frontend/`: `/login`, `/signup`, `/forgot-password`, `/verify-email`, `/onboarding` and `/console`. It forwards `/api/v1/*` to the API (`CORVEN_API_URL`, default `http://127.0.0.1:3001`).

If `FIREBASE_PROJECT_ID` is empty, the login page says sign-in is not configured. Under `CORVEN_DEV_AUTH=1` (local only) it also offers a developer sign-in.

## Not done

Multi-factor authentication, SAML/SSO, an invitation email (members are added by address; the invitee just signs up), per-IP rate limiting of the API, and testing against a live Firebase project (the Firebase Auth emulator issues unsigned tokens, which this verifier deliberately rejects).
