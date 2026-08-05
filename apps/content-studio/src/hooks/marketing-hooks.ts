import { APIError, type CollectionBeforeChangeHook } from "payload";
import { hasAutomationScope, hasEditorRole } from "@/lib/authz";

function canSend(req: Parameters<CollectionBeforeChangeHook>[0]["req"]): boolean {
  return (
    hasEditorRole(req, ["publisher", "admin"]) ||
    hasAutomationScope(req, "marketing:send")
  );
}

export const prepareMarketingTemplate: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req
}) => {
  const documentStatus = data._status ?? originalDoc?._status;

  if (documentStatus === "published" && !canSend(req)) {
    throw new APIError("Only publishers can publish email templates.", 403);
  }
  return data;
};

export const prepareMarketingCampaign: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req
}) => {
  // These fields are maintained by the authenticated marketing action
  // endpoints, not by the editor form. They must remain writable even when a
  // read-only editor refreshes delivery status.
  if (req.context?.marketingLaunch) return data;

  const workflowStatus = data.workflowStatus ?? originalDoc?.workflowStatus;
  const documentStatus = data._status ?? originalDoc?._status;

  if (
    originalDoc?.launchStatus &&
    originalDoc.launchStatus !== "not-launched" &&
    data.campaignKey !== undefined &&
    data.campaignKey !== originalDoc.campaignKey
  ) {
    throw new APIError("The campaign key cannot change after launch.", 409);
  }

  if (
    data.workflowStatus === "approved" &&
    !hasEditorRole(req, ["reviewer", "publisher", "admin"]) &&
    !hasAutomationScope(req, "marketing:send")
  ) {
    throw new APIError("Only reviewers and publishers can approve campaigns.", 403);
  }

  if (documentStatus === "published") {
    if (!canSend(req)) {
      throw new APIError("Only publishers can publish campaigns.", 403);
    }
    if (workflowStatus !== "approved") {
      throw new APIError("Approve this campaign before publishing it.", 400);
    }
  }

  // Delivery state is written only by the signed launch endpoint. Ignoring
  // form input keeps a collection API update from claiming a campaign sent.
  delete data.launchStatus;
  delete data.launchedAt;
  delete data.recipientCount;

  return data;
};
