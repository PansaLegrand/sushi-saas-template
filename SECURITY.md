# Security Policy

## Supported versions

Security fixes are made against the latest release on the default branch. Older
starter snapshots are not maintained as separate release lines.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Default branch | Yes |
| Older releases | No |

Applications built from this starter remain the deployer's responsibility.
Operators should keep dependencies current, rotate copied development secrets,
configure production environment validation, and review every migration before
applying it.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use the repository's **Security** tab and choose **Report a vulnerability** to
open a private security advisory. Include:

- the affected route, component, or commit;
- a minimal reproduction or proof of concept;
- the impact and prerequisites;
- any suggested mitigation;
- whether the report contains secrets or personal data.

If private vulnerability reporting is unavailable, contact a maintainer through
the private channel listed on their profile and ask for a secure reporting
channel. Do not send exploit details in the first public message.

Maintainers should acknowledge a complete report within five business days,
triage severity, coordinate a fix and disclosure date, and credit the reporter
unless anonymity is requested. Timelines may vary with complexity; reporters
will receive progress updates when the assessment changes.

## Scope

Reports are especially valuable for:

- authentication, session, MFA, or organization-boundary bypasses;
- Stripe or credit-ledger duplication and idempotency failures;
- cross-tenant data access;
- credential or personal-data disclosure;
- unsafe file upload, storage, or signed-URL behavior;
- rate-limit bypasses with material abuse impact;
- dependency vulnerabilities reachable in the shipped configuration.

Configuration questions, unsupported customizations, and vulnerabilities only
present after disabling a documented production safeguard belong in regular
issues or discussions.
