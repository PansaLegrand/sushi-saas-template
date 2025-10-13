#!/usr/bin/env bash
set -euo pipefail

if ! command -v stripe >/dev/null 2>&1; then
  echo "Stripe CLI not found. Install from https://stripe.com/docs/stripe-cli" >&2
  exit 1
fi

stripe trigger checkout_session_completed

