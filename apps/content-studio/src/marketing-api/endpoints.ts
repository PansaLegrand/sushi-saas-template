import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Endpoint, PayloadRequest } from "payload";
import { hasAutomationScope, hasEditorRole, isStudioUser, type AutomationScope } from "@/lib/authz";
import { loadCampaignMessage } from "./campaign-message";
import { callMarketingGateway, MarketingGatewayError } from "./gateway";
import { renderCampaignPreview } from "./render";

function permitted(
  req: PayloadRequest,
  scope: AutomationScope,
  roles: Parameters<typeof hasEditorRole>[1]
): boolean {
  return hasEditorRole(req, roles) || hasAutomationScope(req, scope);
}

function denied(req: PayloadRequest): Response {
  return Response.json(
    {
      error: {
        code: req.user ? "MARKETING_FORBIDDEN" : "MARKETING_AUTH_REQUIRED",
        message: "You do not have permission to perform this marketing action."
      }
    },
    { status: req.user ? 403 : 401 }
  );
}

function errorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) {
    return Response.json(
      {
        valid: false,
        error: {
          code: "MARKETING_VALIDATION_FAILED",
          message: "The campaign needs attention before it can be used.",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message
          }))
        }
      },
      { status: 422 }
    );
  }
  if (error instanceof MarketingGatewayError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message
        }
      },
      { status: error.status }
    );
  }
  return Response.json(
    {
      error: {
        code: "MARKETING_ACTION_FAILED",
        message: error instanceof Error ? error.message : "The marketing action failed."
      }
    },
    { status: 502 }
  );
}

function gatewayData(result: Record<string, unknown>): Record<string, unknown> {
  return result.data && typeof result.data === "object"
    ? (result.data as Record<string, unknown>)
    : result;
}

async function loadCampaignKey(req: PayloadRequest, id: string): Promise<string> {
  const campaign = await req.payload.findByID({
    collection: "marketing-campaigns",
    id,
    draft: true,
    depth: 0,
    overrideAccess: true,
    req
  });
  return z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9._:-]*$/)
    .parse(campaign.campaignKey);
}

function audience(campaign: Record<string, unknown>, locale: string) {
  return {
    topic: String(campaign.audienceTopic),
    ...(campaign.filterAudienceByLocale === false ? {} : { locale })
  };
}

async function body(req: PayloadRequest): Promise<unknown> {
  if (!req.json) return {};
  try {
    return await req.json();
  } catch {
    return {};
  }
}

const previewCampaign: Endpoint = {
  path: "/marketing/v1/campaigns/:id/preview",
  method: "get",
  handler: async (req) => {
    if (!isStudioUser(req) && !hasAutomationScope(req, "marketing:read")) return denied(req);
    try {
      const { message } = await loadCampaignMessage({
        req,
        id: String(req.routeParams?.id ?? ""),
        draft: true
      });
      return new Response(renderCampaignPreview(message), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'",
          "referrer-policy": "no-referrer"
        }
      });
    } catch (error) {
      return errorResponse(error);
    }
  }
};

const validateCampaign: Endpoint = {
  path: "/marketing/v1/campaigns/:id/validate",
  method: "post",
  handler: async (req) => {
    if (!isStudioUser(req) && !hasAutomationScope(req, "marketing:read")) return denied(req);
    try {
      const { campaign, message } = await loadCampaignMessage({
        req,
        id: String(req.routeParams?.id ?? ""),
        draft: true
      });
      const result = await callMarketingGateway("/api/internal/marketing/audience", {
        requestId: `validate:${randomUUID()}`,
        audience: audience(campaign, message.locale)
      });
      return Response.json({ valid: true, message, audience: gatewayData(result) });
    } catch (error) {
      return errorResponse(error);
    }
  }
};

const TestSchema = z.object({
  recipient: z.email().max(320),
  requestId: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9._:-]*$/)
    .optional()
});

const testCampaign: Endpoint = {
  path: "/marketing/v1/campaigns/:id/test",
  method: "post",
  handler: async (req) => {
    if (!permitted(req, "marketing:test", ["publisher", "admin"])) return denied(req);
    try {
      const input = TestSchema.parse(await body(req));
      const { message } = await loadCampaignMessage({
        req,
        id: String(req.routeParams?.id ?? ""),
        draft: true
      });
      const gateway = await callMarketingGateway("/api/internal/marketing/test", {
        requestId: input.requestId ?? `test:${randomUUID()}`,
        recipient: input.recipient,
        message
      });
      return Response.json({ data: gatewayData(gateway) });
    } catch (error) {
      return errorResponse(error);
    }
  }
};

const launchCampaign: Endpoint = {
  path: "/marketing/v1/campaigns/:id/launch",
  method: "post",
  handler: async (req) => {
    if (!permitted(req, "marketing:send", ["publisher", "admin"])) return denied(req);
    const id = String(req.routeParams?.id ?? "");
    let dispatchAttempted = false;
    let markFailedOnError = false;
    try {
      // Only the published version can launch. A later autosave must not alter
      // copy after a publisher approved the exact version being queued.
      const { campaign, message } = await loadCampaignMessage({ req, id, draft: false });
      if (campaign._status !== "published" || campaign.workflowStatus !== "approved") {
        return Response.json(
          {
            error: {
              code: "MARKETING_APPROVAL_REQUIRED",
              message: "Publish an approved campaign before launching it."
            }
          },
          { status: 409 }
        );
      }
      markFailedOnError = !["scheduled", "queued", "completed", "canceled"].includes(
        String(campaign.launchStatus ?? "not-launched")
      );

      const scheduleAt =
        typeof campaign.scheduledAt === "string" && campaign.scheduledAt
          ? campaign.scheduledAt
          : undefined;
      dispatchAttempted = true;
      const gateway = await callMarketingGateway("/api/internal/marketing/dispatch", {
        requestId: `launch:${message.campaignKey}`,
        message,
        audience: {
          topic: String(campaign.audienceTopic),
          ...(campaign.filterAudienceByLocale === false
            ? {}
            : { locale: message.locale })
        },
        ...(scheduleAt ? { scheduleAt } : {})
      });
      const result = gatewayData(gateway);
      const scheduled = scheduleAt && Date.parse(scheduleAt) > Date.now();
      const launchStatus =
        result.status === "completed"
          ? "completed"
          : scheduled
            ? "scheduled"
            : "queued";
      await req.payload.update({
        collection: "marketing-campaigns",
        id,
        draft: false,
        data: {
          launchStatus,
          launchedAt: new Date().toISOString(),
          recipientCount:
            typeof result.recipients === "number" ? result.recipients : 0
        },
        overrideAccess: true,
        req,
        context: { marketingLaunch: true }
      });
      return Response.json({ data: result });
    } catch (error) {
      if (dispatchAttempted && markFailedOnError) {
        try {
          await req.payload.update({
            collection: "marketing-campaigns",
            id,
            draft: false,
            data: { launchStatus: "failed" },
            overrideAccess: true,
            req,
            context: { marketingLaunch: true }
          });
        } catch {
          // Preserve the original gateway/validation error.
        }
      }
      return errorResponse(error);
    }
  }
};

const campaignStatus: Endpoint = {
  path: "/marketing/v1/campaigns/:id/status",
  method: "post",
  handler: async (req) => {
    if (!isStudioUser(req) && !hasAutomationScope(req, "marketing:read")) return denied(req);
    const id = String(req.routeParams?.id ?? "");
    try {
      const campaignKey = await loadCampaignKey(req, id);
      const result = gatewayData(
        await callMarketingGateway("/api/internal/marketing/status", {
          requestId: `status:${randomUUID()}`,
          campaignKey
        })
      );
      const status = String(result.status ?? "queued");
      if (["scheduled", "queued", "completed", "canceled", "failed"].includes(status)) {
        await req.payload.update({
          collection: "marketing-campaigns",
          id,
          draft: false,
          data: {
            launchStatus: status as "scheduled" | "queued" | "completed" | "canceled" | "failed",
            ...(typeof result.recipients === "number"
              ? { recipientCount: result.recipients }
              : {})
          },
          overrideAccess: true,
          req,
          context: { marketingLaunch: true }
        });
      }
      return Response.json({ data: result });
    } catch (error) {
      return errorResponse(error);
    }
  }
};

const cancelCampaign: Endpoint = {
  path: "/marketing/v1/campaigns/:id/cancel",
  method: "post",
  handler: async (req) => {
    if (!permitted(req, "marketing:send", ["publisher", "admin"])) return denied(req);
    const id = String(req.routeParams?.id ?? "");
    try {
      const campaignKey = await loadCampaignKey(req, id);
      const result = gatewayData(
        await callMarketingGateway("/api/internal/marketing/cancel", {
          requestId: `cancel:${randomUUID()}`,
          campaignKey
        })
      );
      await req.payload.update({
        collection: "marketing-campaigns",
        id,
        draft: false,
        data: { launchStatus: "canceled" },
        overrideAccess: true,
        req,
        context: { marketingLaunch: true }
      });
      return Response.json({ data: result });
    } catch (error) {
      return errorResponse(error);
    }
  }
};

export const marketingApiEndpoints: Endpoint[] = [
  previewCampaign,
  validateCampaign,
  testCampaign,
  launchCampaign,
  campaignStatus,
  cancelCampaign
];
