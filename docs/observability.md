# Observability

The starter emits structured Pino logs by default and can optionally register
OpenTelemetry tracing through the standard OTLP environment contract. No
collector, hosted vendor, or API key is required for a fresh clone; telemetry is
a no-op until explicitly enabled.

## Enable OTLP tracing

```bash
OTEL_ENABLED=true
OTEL_SERVICE_NAME=my-saas-web
OTEL_EXPORTER_OTLP_ENDPOINT=https://collector.example.com/v1/traces
OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer <collector-token>"
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

`OTEL_EXPORTER_OTLP_HEADERS` is treated as a secret by the environment-aware log
redactor. Use independent service names for web, admin, Studio, and a dedicated
worker when those processes export to the same backend.

Next.js request/fetch spans are registered in `src/instrumentation.ts`. Custom
job enqueue/execution spans add job type, attempt, outcome, and stable job UUID.
Every server log written inside an active span carries `trace_id` and `span_id`,
so an incident can move from a log line to the complete request/job trace
without interpolating a provider-specific URL.

The `onRequestError` instrumentation hook records App Router render, route, and
action failures that never reach an API `catch`. It logs route metadata and the
Next error digest but never request headers, cookies, or arbitrary response
bodies.

## Queue health metrics

`GET /api/ready` exposes payload-free queue signals:

- total pending and currently due jobs;
- running, failed, and stale-running jobs;
- age of the oldest due job.

Failed/stale jobs, or a due job older than ten minutes, mark the queue
`degraded` without taking customer traffic out of service. Database, environment,
and distributed Redis failures still make readiness fail with HTTP 503.

Recommended alerts:

| Signal                   | Initial threshold            |
| ------------------------ | ---------------------------- |
| Readiness HTTP 503       | 2 consecutive probes         |
| Queue degraded           | 10 minutes                   |
| Failed jobs              | any sustained non-zero count |
| Oldest due age           | over 10 minutes              |
| Stripe `action_required` | any new event                |
| Rate-limit store failure | any production event         |

Tune these after observing real traffic. Do not put user emails, object keys,
full URLs, raw webhook bodies, or unbounded identifiers into metric labels.

## Suggested starter SLOs

- availability: 99.9% successful non-user-error requests;
- latency: 95% of ordinary authenticated reads below 500 ms at the application;
- durable work: 99% of due jobs start within ten minutes;
- billing: every live Stripe event reaches `completed` or `action_required`;
- data safety: scheduled restore drills meet the documented RPO/RTO.

SLOs are deployment policy, not hardcoded product behavior. Record the chosen
targets and alert ownership in the adopting repository's operational runbook.
