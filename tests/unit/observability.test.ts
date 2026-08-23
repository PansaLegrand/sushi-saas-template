/**
 * Trace/log correlation must remain vendor-neutral and safe when telemetry is
 * disabled. These tests exercise the OpenTelemetry API directly without a
 * collector or mocked provider.
 */
import { TraceFlags } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";

import {
  activeTraceFields,
  traceFieldsForSpanContext,
  withSpan,
} from "@/lib/observability";

describe("observability primitives", () => {
  it("returns no correlation fields outside an active span", () => {
    expect(activeTraceFields()).toEqual({});
  });

  it("extracts W3C trace identifiers from the active context", () => {
    const fields = traceFieldsForSpanContext({
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
      traceFlags: TraceFlags.SAMPLED,
    });

    expect(fields).toEqual({
      trace_id: "a".repeat(32),
      span_id: "b".repeat(16),
    });
  });

  it("preserves results and errors when no SDK is registered", async () => {
    await expect(
      withSpan("test.success", { component: "unit" }, async () => 42),
    ).resolves.toBe(42);

    await expect(
      withSpan("test.failure", {}, async () => {
        throw new Error("expected failure");
      }),
    ).rejects.toThrow("expected failure");
  });
});
