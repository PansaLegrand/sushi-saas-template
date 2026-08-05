# Marketing email

Marketing authoring lives in Content Studio; transactional email remains in the
SaaS application.

| Responsibility | Owner |
| --- | --- |
| Reusable brand layouts, campaign copy, block editing, preview, review, approval, scheduling | Content Studio |
| Password, verification, invitation, billing, reservation, and other transactional templates | `src/services/email/templates` |
| Subscriber addresses, topics, consent evidence, unsubscribe state, suppression, delivery audit | SaaS database |
| Audience resolution, durable jobs, Resend credentials, final rendering, provider calls | SaaS services |

This boundary prevents Content Studio from becoming a second customer database
and makes an unsubscribe authoritative even after a campaign was scheduled.

## Author workflow

1. Create a brand layout under **Marketing → Email templates**. A physical
   sender address is required.
2. Create an **Email campaign**, choose its locale and consent topic, and compose
   it from heading, text, image, button, divider, and spacer blocks. Raw HTML is
   not accepted.
3. Use **Open preview** and **Validate**. Validation also resolves and displays
   the current consented audience count without exposing addresses. A publisher
   can send a test; the test address goes directly to the SaaS and is not
   stored by Payload.
4. Set the workflow to `approved` and publish the exact Payload version.
5. Optionally set `scheduledAt`, then use **Launch approved campaign**.
6. Use **Refresh delivery status** for sent/delivered/bounce/complaint totals,
   or **Cancel pending delivery** to stop work that has not reached Resend.

Launch sends a signed request to the SaaS. The SaaS resolves only currently
subscribed records, creates one durable job per recipient, and applies a unique
campaign/subscription key. Retrying the same launch cannot duplicate delivery.
The worker checks consent again immediately before Resend, adds the postal
footer and unsubscribe link, and supplies `List-Unsubscribe` one-click headers.
Canceling marks pending jobs and unsent deliveries as canceled/skipped; a job
already held by a worker checks campaign state before its provider call. A
provider-accepted message cannot be recalled.

## Configuration

Content Studio:

```dotenv
SAAS_MARKETING_API_URL=http://localhost:3000
CONTENT_MARKETING_SECRET=<32+ random bytes shared with SaaS>
```

SaaS application:

```dotenv
CONTENT_MARKETING_SECRET=<same gateway secret>
MARKETING_UNSUBSCRIBE_SECRET=<different stable 32+ byte secret>
RESEND_API_KEY=...
RESEND_WEBHOOK_SECRET=<Resend endpoint signing secret>
EMAIL_FROM="Your Brand <mail@example.com>"
```

The gateway signature covers `timestamp + raw body` and expires after five
minutes. Keep the unsubscribe secret separate: rotating a gateway credential
must not invalidate links in already delivered mail.

Create a Resend webhook endpoint at:

```text
https://<saas-host>/api/marketing/webhooks/resend
```

Subscribe it to `email.sent`, `email.delivery_delayed`, `email.delivered`,
`email.bounced`, `email.complained`, `email.failed`, and `email.suppressed`.
Also subscribe to `suppression.added` and `suppression.removed` so a deliberate
provider-dashboard suppression change is reflected in the SaaS consent store.
Store that endpoint's signing secret as `RESEND_WEBHOOK_SECRET`. The SaaS
verifies the raw signed body, deduplicates on `svix-id`, tolerates out-of-order
events, and suppresses every marketing topic for the affected mailbox after a
bounce, complaint, or provider suppression. Only event identifiers and
delivery state are retained; raw webhook payloads and recipient addresses are
not copied into the provider-event ledger.

## Automation API

Payload's collection APIs create and update email templates and campaigns for
batch-generation or keyword/content workflows. Give a Service Account only the
required `marketing:*` scopes and use Payload's API-key header described in
[content-platform.md](content-platform.md). Operational campaign endpoints are:

| Method | Content Studio endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/marketing/v1/campaigns/:id/preview` | Render the saved draft safely |
| `POST` | `/api/marketing/v1/campaigns/:id/validate` | Validate copy/template and count the live audience |
| `POST` | `/api/marketing/v1/campaigns/:id/test` | Queue a test; accepts `recipient` and optional stable `requestId` |
| `POST` | `/api/marketing/v1/campaigns/:id/launch` | Launch only an approved, published version |
| `POST` | `/api/marketing/v1/campaigns/:id/status` | Refresh aggregate delivery state |
| `POST` | `/api/marketing/v1/campaigns/:id/cancel` | Cancel jobs that have not reached the provider |

The optional test `requestId` makes workflow retries idempotent. Campaign
launches use the immutable `campaignKey` as their idempotency identity; reuse
with different content, audience, or schedule is rejected.

## Consent API

An adopting signup or preference form records explicit consent with:

```http
POST /api/marketing/subscriptions
Content-Type: application/json

{
  "email": "reader@example.com",
  "topic": "product-updates",
  "locale": "en",
  "consent": true,
  "consentSource": "website-footer",
  "consentVersion": "2026-08"
}
```

The route is same-origin and rate limited. Re-subscribing requires a new
explicit consent event and updates its evidence. Unsubscribe links show a
confirmation page; provider one-click POST requests and repeated submissions
are idempotent. Transactional messages do not use this table and are not
disabled by a marketing unsubscribe.

The first release caps one launch at 5,000 recipients and validation reports
when the current audience exceeds that limit. Raise it only after adding
chunked audience snapshots and verifying provider throughput and cron
frequency.
