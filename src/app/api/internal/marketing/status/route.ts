import { AppError } from "@/lib/errors";
import { respError } from "@/lib/errors/response";
import { respData } from "@/lib/resp";
import { MarketingCampaignActionRequestSchema } from "@/services/marketing/contracts";
import { getMarketingCampaignStatus } from "@/services/marketing/operations";
import { requireContentStudioSignature } from "@/services/marketing/signature";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.text();
    if (new TextEncoder().encode(body).byteLength > 16 * 1024) {
      throw new AppError("REQUEST_BODY_TOO_LARGE", {
        details: { maxBytes: 16 * 1024 },
      });
    }
    requireContentStudioSignature(req, body);

    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch (cause) {
      throw new AppError("REQUEST_MALFORMED_JSON", { cause });
    }
    const parsed = MarketingCampaignActionRequestSchema.safeParse(json);
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

    return respData(await getMarketingCampaignStatus(parsed.data));
  } catch (error) {
    return respError(error, {
      fallback: "SERVER_ERROR",
      logFields: { event: "marketing.status_failed" },
    });
  }
}
