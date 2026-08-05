import {
  APIError,
  type CollectionAfterChangeHook,
  type CollectionAfterDeleteHook,
  type CollectionBeforeChangeHook,
  type PayloadRequest
} from "payload";
import { canPublish, hasEditorRole, isStudioUser } from "@/lib/authz";
import { notifyPublicSite } from "@/lib/revalidate-site";
import { publishingIssue } from "@/lib/publishing";
import { normalizeSlug } from "@/lib/slugs";

export const prepareContent: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  if (typeof data.slug === "string") data.slug = normalizeSlug(data.slug);

  if (data._status === "published" && !canPublish(req)) {
    throw new APIError("Only publishers can publish content.", 403);
  }

  if (data._status === "published") {
    const issue = publishingIssue({ ...(originalDoc ?? {}), ...data });
    if (issue) throw new APIError(issue, 400);
  }

  if (
    data.workflowStatus === "approved" &&
    !hasEditorRole(req, ["reviewer", "publisher", "admin"]) &&
    !canPublish(req)
  ) {
    throw new APIError("Only reviewers and publishers can approve content.", 403);
  }

  const now = new Date().toISOString();
  if (data._status === "published" && !originalDoc?.publishedAt) data.publishedAt = now;

  if (isStudioUser(req)) {
    data.provenance = {
      ...(originalDoc?.provenance ?? {}),
      ...(data.provenance ?? {}),
      lastHumanEditAt: now
    };
  }

  return data;
};

const contentLocales = ["en", "zh", "es", "fr", "ja"] as const;

async function notifyChangedDocument({
  collection,
  doc,
  req
}: {
  collection: string;
  doc: Record<string, unknown>;
  req: PayloadRequest;
}): Promise<void> {
  if (collection !== "pages" && collection !== "posts") return;
  if (!doc.slug) return;

  const requestedLocale = typeof req.locale === "string" ? req.locale : null;
  const locales = contentLocales.includes(requestedLocale as (typeof contentLocales)[number])
    ? [requestedLocale as (typeof contentLocales)[number]]
    : contentLocales;

  const results = await Promise.allSettled(
    locales.map((locale) =>
      notifyPublicSite({
        collection,
        locale,
        slug: String(doc.slug)
      })
    )
  );
  for (const result of results) {
    if (result.status === "rejected") {
      req.payload.logger.error(
        { err: result.reason },
        "Unable to revalidate the public content site"
      );
    }
  }
}

export const revalidateContent: CollectionAfterChangeHook = async ({ collection, doc, req }) => {
  await notifyChangedDocument({ collection: collection.slug, doc, req });
  return doc;
};

export const revalidateDeletedContent: CollectionAfterDeleteHook = async ({ collection, doc, req }) => {
  await notifyChangedDocument({ collection: collection.slug, doc, req });
  return doc;
};
