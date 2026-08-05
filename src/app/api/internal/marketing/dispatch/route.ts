import { AppError } from "@/lib/errors";
import { respError } from "@/lib/errors/response";
import { respData } from "@/lib/resp";
import { MarketingDispatchRequestSchema } from "@/services/marketing/contracts";
import { dispatchMarketingCampaign } from "@/services/marketing/dispatch";
import { requireContentStudioSignature } from "@/services/marketing/signature";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.text();
    if (new TextEncoder().encode(body).byteLength > 256 * 1024) {
      throw new AppError("REQUEST_BODY_TOO_LARGE", {
        details: { maxBytes: 256 * 1024 },
      });
    }
    requireContentStudioSignature(req, body);

    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch (cause) {
      throw new AppError("REQUEST_MALFORMED_JSON", { cause });
    }
    const parsed = MarketingDispatchRequestSchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError("REQUEST_VALIDATION_FAILED", {
        message: parsed.error.message,
        details: {
          fields: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            code: issue.code,
          })),
        },
      });
    }

    return respData(await dispatchMarketingCampaign(parsed.data));
  } catch (error) {
    return respError(error, {
      fallback: "SERVER_ERROR",
      logFields: { event: "marketing.dispatch_failed" },
    });
  }
}
