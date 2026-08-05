import { createHmac } from "node:crypto";

function sign(body: string, timestamp: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export class MarketingGatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "MarketingGatewayError";
  }
}

export async function callMarketingGateway(
  path:
    | "/api/internal/marketing/test"
    | "/api/internal/marketing/dispatch"
    | "/api/internal/marketing/audience"
    | "/api/internal/marketing/status"
    | "/api/internal/marketing/cancel",
  payload: unknown
): Promise<Record<string, unknown>> {
  const baseUrl = process.env.SAAS_MARKETING_API_URL;
  const secret = process.env.CONTENT_MARKETING_SECRET;
  if (!baseUrl || !secret) {
    throw new Error(
      "Marketing delivery is not configured. Set SAAS_MARKETING_API_URL and CONTENT_MARKETING_SECRET."
    );
  }

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-content-timestamp": timestamp,
      "x-content-signature": sign(body, timestamp, secret)
    },
    body,
    signal: AbortSignal.timeout(30_000)
  });

  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof result.error_code === "string" ? result.error_code : "MARKETING_GATEWAY_FAILED";
    throw new MarketingGatewayError(
      `The SaaS marketing gateway rejected the request (${code}, HTTP ${response.status}).`,
      response.status,
      code
    );
  }
  return result;
}
