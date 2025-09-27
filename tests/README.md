API Test Suite
==============

Goals
-----
- Validate API handlers without running a full HTTP server.
- Mock external dependencies (auth, DB, Stripe) so tests are fast and deterministic.
- Keep a couple of Stripe CLI helpers for manual end-to-end checks when needed.

Layout
------
- `tests/api/*` — Integration tests for API route modules.
- `tests/unit/*` — Lightweight unit tests (pure helpers, serializers).

Runner & Commands
-----------------
- Uses Vitest (Node environment).
- Commands:
  - `pnpm test` — run in watch/interactive mode.
  - `pnpm test:run` — single pass.
  - `pnpm test:cov` — with coverage.

Environment
-----------
- Tests run with Node’s Fetch/Response (Node 20+). No server is started.
- For Stripe webhook tests, a dummy `STRIPE_WEBHOOK_SECRET` is set in test context; signature is generated in-process.
- No real network or database calls are performed — related modules are mocked.

Expected Outcomes
-----------------
- Credits endpoints (grant/consume/summary) return the right shapes and call the underlying services with correct arguments.
- Checkout endpoint validates pricing, inserts an order, creates a Stripe session, and returns a redirect URL.
- Webhook endpoint verifies Stripe’s signature and dispatches `checkout.session.completed` to the handler.

Stripe CLI (Manual Aids)
------------------------
For manual end-to-end checks during development:

```bash
# Login once
stripe login

# Forward events to your local webhook endpoint
stripe listen --forward-to localhost:3000/api/pay/webhook/stripe

# Trigger a test Checkout completion event
stripe trigger checkout_session_completed
```

Make sure `.env.local` contains:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_WEB_URL=http://localhost:3000
```

