import "server-only";

import {
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
  type SpanContext,
} from "@opentelemetry/api";

const tracer = trace.getTracer("sushi-saas-starter");

export function traceFieldsForSpanContext(
  context: SpanContext | undefined,
): Record<string, string> {
  if (!context || !context.traceId || !context.spanId) return {};

  return {
    trace_id: context.traceId,
    span_id: context.spanId,
  };
}

/** Correlate structured logs with the active W3C trace without a vendor SDK. */
export function activeTraceFields(): Record<string, string> {
  return traceFieldsForSpanContext(trace.getActiveSpan()?.spanContext());
}

/**
 * Small tracing primitive for domain operations not covered by Next/fetch
 * auto-instrumentation. With no registered provider this is a cheap no-op.
 */
export function withSpan<T>(
  name: string,
  attributes: Attributes,
  operation: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await operation(span);
    } catch (error) {
      if (error instanceof Error) span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "unknown error",
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
