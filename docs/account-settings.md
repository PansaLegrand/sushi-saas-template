# Account settings contract

`/[locale]/account/profile` and `/[locale]/account/privacy` are authenticated,
localized customer surfaces. `/[locale]/me` redirects to the profile page.
These settings belong to the signed-in account across workspaces; the workspace
URL still controls navigation to tenant-owned pages.

## Profile and security

- Profile writes accept only a trimmed display name, up to 100 characters.
  The service uses Better Auth's update API and writes an authentication audit
  event. Roles, email verification, and provider links are not editable here.
- Password changes require the existing password and revoke other sessions.
  Provider-only accounts use the existing fresh-session first-password service.
- Every customer can configure TOTP and save backup codes. Administrative
  accounts continue to require MFA before admin access.
- `GET /api/account/settings` projects at most 100 recent, unexpired sessions.
  The management DTO contains hashed references, timestamps and user agents;
  it never includes session tokens or internal session IDs.
- `DELETE /api/account/sessions` requires same origin and a session created in
  the last 15 minutes. Revocation resolves the reference within the caller's
  session inventory; an absent reference is an idempotent no-op. The current
  session is protected; ordinary sign-out remains the way to end it.
- Public Better Auth list/revoke-session endpoints are closed on both the web
  and admin gateways, so they cannot bypass the management DTO or freshness
  policy. Server-side SDK methods still perform revocation. Normal SDK sign-in,
  get-session, sign-out, and MFA endpoints remain available.

## Data and deletion

The UI calls the existing durable account lifecycle services. Export submission
keeps its idempotency key across transient failures. The latest export metadata
is restored by the server page and polled through a separate read-rate bucket;
failed jobs and expired artifacts remain visible. Signed downloads are minted
only after an explicit request through the owner-scoped export endpoint.

Deletion requires typed email confirmation in a keyboard-accessible dialog.
The server remains authoritative for fresh authentication, ownership transfer,
admin continuity, the seven-day grace period, cancellation, and erasure. The UI
links blocking workspaces to their team settings. It never performs erasure in
the request path. All account error text uses the five-locale error catalog.

## Verification

Service/API tests cover authentication gates, fresh-session checks, replayed
revocation, owner scope, and token redaction. Real database tests cover session
expiry and export/job joins. Component tests cover deletion confirmation,
ownership guidance and export retry identity. Playwright verifies real profile
writes, reload, management DTOs, native endpoint closure, and the mobile dialog.
