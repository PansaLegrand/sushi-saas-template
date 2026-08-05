import { z } from "zod";
import type { Endpoint, PayloadRequest } from "payload";
import {
  batchImportSchema,
  contentBriefSchema,
  contentLocales,
  portableDraftSchema,
  workflowTransitionSchema
} from "@/content-api/schemas";
import {
  completeReplay,
  idempotencyKey,
  releaseReplay,
  requestHash,
  reserveReplay
} from "@/content-api/idempotency";
import {
  serializeDraftDocument,
  serializePublishedDocument,
  toPayloadDraft
} from "@/content-api/transform";
import { jobOwnerIdentity, sanitizedJobLog } from "@/content-api/job-status";
import { hasEditorRole, requireScope } from "@/lib/authz";
import type { AutomationRequest } from "@/payload-types";

function validationError(error: z.ZodError): Response {
  return Response.json(
    {
      valid: false,
      error: {
        code: "CONTENT_VALIDATION_FAILED",
        message: "The content payload is invalid.",
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
      }
    },
    { status: 422 }
  );
}

async function json(req: PayloadRequest): Promise<unknown | Response> {
  try {
    if (!req.json) throw new Error("Request body is unavailable.");
    return await req.json();
  } catch {
    return Response.json(
      { error: { code: "INVALID_JSON", message: "The request body must be valid JSON." } },
      { status: 400 }
    );
  }
}

async function replayable(
  req: PayloadRequest,
  operation: string,
  body: unknown,
  run: () => Promise<{ statusCode: number; response: AutomationRequest["response"] }>
): Promise<Response> {
  const key = idempotencyKey(req);
  if (!key) {
    return Response.json(
      { error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "Send an Idempotency-Key header." } },
      { status: 400 }
    );
  }
  const hash = requestHash(operation, body);
  const reservation = await reserveReplay(req, key, hash, operation);
  if (reservation.response) return reservation.response;

  let result: Awaited<ReturnType<typeof run>>;
  try {
    result = await run();
  } catch (error) {
    await releaseReplay(req, reservation.id);
    throw error;
  }

  try {
    await completeReplay({ req, id: reservation.id, ...result });
  } catch (error) {
    // Keep the processing reservation: deleting it after the side effect has
    // succeeded would let the next retry create the content a second time.
    req.payload.logger.error(
      { err: error, automationRequestId: reservation.id },
      "Unable to finalize API idempotency replay result"
    );
  }
  return Response.json(result.response, { status: result.statusCode });
}

function routeCollection(req: PayloadRequest): "pages" | "posts" | null {
  const value = req.routeParams?.collection;
  return value === "pages" || value === "posts" ? value : null;
}

function invalidContentPath(): Response {
  return Response.json(
    { error: { code: "CONTENT_NOT_FOUND", message: "The content document does not exist." } },
    { status: 404 }
  );
}

const validateDraft: Endpoint = {
  path: "/content/v1/validate",
  method: "post",
  handler: async (req) => {
    const denied = requireScope(req, "content:draft:create");
    if (denied) return denied;
    const body = await json(req);
    if (body instanceof Response) return body;
    const result = portableDraftSchema.safeParse(body);
    if (!result.success) return validationError(result.error);
    return Response.json({ valid: true, normalized: result.data });
  }
};

const createDraft: Endpoint = {
  path: "/content/v1/drafts",
  method: "post",
  handler: async (req) => {
    const denied = requireScope(req, "content:draft:create");
    if (denied) return denied;
    const body = await json(req);
    if (body instanceof Response) return body;
    const result = portableDraftSchema.safeParse(body);
    if (!result.success) return validationError(result.error);

    return replayable(req, "create-draft", result.data, async () => {
      const document = await req.payload.create({
        collection: result.data.collection,
        data: toPayloadDraft(result.data, req.payload.config),
        draft: true,
        locale: result.data.locale,
        overrideAccess: true,
        req
      });
      return {
        statusCode: 201,
        response: {
          data: {
            collection: result.data.collection,
            id: document.id,
            slug: result.data.slug,
            locale: result.data.locale,
            status: "draft"
          }
        }
      };
    });
  }
};

const getDraft: Endpoint = {
  path: "/content/v1/drafts/:collection/:id",
  method: "get",
  handler: async (req) => {
    const denied = requireScope(req, "content:read");
    if (denied) return denied;
    const collection = routeCollection(req);
    const id = String(req.routeParams?.id ?? "");
    const url = new URL(req.url ?? "http://localhost");
    const localeResult = workflowTransitionSchema.safeParse({
      locale: url.searchParams.get("locale") ?? "en"
    });
    if (!collection || !id || !localeResult.success) return invalidContentPath();

    try {
      const document = await req.payload.findByID({
        collection,
        id,
        draft: true,
        locale: localeResult.data.locale,
        fallbackLocale: false,
        depth: 2,
        overrideAccess: true,
        req
      });
      return Response.json({
        data: serializeDraftDocument(
          collection,
          document as unknown as Record<string, unknown>
        )
      });
    } catch {
      return invalidContentPath();
    }
  }
};

const updateDraft: Endpoint = {
  path: "/content/v1/drafts/:collection/:id",
  method: "put",
  handler: async (req) => {
    const denied = requireScope(req, "content:draft:update");
    if (denied) return denied;
    const collection = routeCollection(req);
    const id = String(req.routeParams?.id ?? "");
    if (!collection || !id) return invalidContentPath();

    const body = await json(req);
    if (body instanceof Response) return body;
    const result = portableDraftSchema.safeParse(body);
    if (!result.success) return validationError(result.error);
    if (result.data.collection !== collection) {
      return Response.json(
        {
          error: {
            code: "CONTENT_COLLECTION_MISMATCH",
            message: "The route and request body must use the same collection."
          }
        },
        { status: 409 }
      );
    }

    return replayable(req, "update-draft", { id, ...result.data }, async () => {
      const document = await req.payload.update({
        collection,
        id,
        data: toPayloadDraft(result.data, req.payload.config),
        draft: true,
        locale: result.data.locale,
        overrideAccess: true,
        req
      });
      return {
        statusCode: 200,
        response: {
          data: {
            collection,
            id: document.id,
            slug: result.data.slug,
            locale: result.data.locale,
            status: "draft"
          }
        }
      };
    });
  }
};

function transitionDraft({
  action,
  scope,
  workflowStatus,
  publish = false
}: {
  action: "submit" | "publish";
  scope: "content:submit" | "content:publish";
  workflowStatus: "in-review" | "approved";
  publish?: boolean;
}): Endpoint {
  return {
    path: `/content/v1/drafts/:collection/:id/${action}`,
    method: "post",
    handler: async (req) => {
      const denied = requireScope(req, scope);
      if (denied) return denied;
      const collection = routeCollection(req);
      const id = String(req.routeParams?.id ?? "");
      if (!collection || !id) return invalidContentPath();

      const body = await json(req);
      if (body instanceof Response) return body;
      const result = workflowTransitionSchema.safeParse(body);
      if (!result.success) return validationError(result.error);

      return replayable(req, `${action}-draft`, { collection, id, ...result.data }, async () => {
        const document = await req.payload.update({
          collection,
          id,
          data: {
            workflowStatus,
            ...(publish ? { _status: "published" as const } : {})
          },
          draft: !publish,
          locale: result.data.locale,
          overrideAccess: true,
          req
        });
        return {
          statusCode: 200,
          response: {
            data: {
              collection,
              id: document.id,
              locale: result.data.locale,
              status: publish ? "published" : "in-review"
            }
          }
        };
      });
    }
  };
}

const submitDraft = transitionDraft({
  action: "submit",
  scope: "content:submit",
  workflowStatus: "in-review"
});

const publishDraft = transitionDraft({
  action: "publish",
  scope: "content:publish",
  workflowStatus: "approved",
  publish: true
});

const createImport: Endpoint = {
  path: "/content/v1/imports",
  method: "post",
  handler: async (req) => {
    const denied = requireScope(req, "content:draft:create");
    if (denied) return denied;
    const body = await json(req);
    if (body instanceof Response) return body;
    const result = batchImportSchema.safeParse(body);
    if (!result.success) return validationError(result.error);

    return replayable(req, "batch-import", result.data, async () => {
      const job = await req.payload.jobs.queue({
        task: "importContent",
        queue: "content",
        input: {
          items: result.data.items,
          identity: `${req.user?.collection}:${req.user?.id}`
        },
        req
      });
      return {
        statusCode: 202,
        response: { data: { jobId: job.id, status: "queued", itemCount: result.data.items.length } }
      };
    });
  }
};

const createBrief: Endpoint = {
  path: "/content/v1/briefs",
  method: "post",
  handler: async (req) => {
    const denied = requireScope(req, "content:draft:create");
    if (denied) return denied;
    const body = await json(req);
    if (body instanceof Response) return body;
    const result = contentBriefSchema.safeParse(body);
    if (!result.success) return validationError(result.error);

    return replayable(req, "create-brief", result.data, async () => {
      const brief = await req.payload.create({
        collection: "content-briefs",
        data: {
          ...result.data,
          secondaryKeywords: result.data.secondaryKeywords.map((keyword) => ({ keyword })),
          status: "idea"
        },
        overrideAccess: true,
        req
      });
      return { statusCode: 201, response: { data: { id: brief.id, status: "idea" } } };
    });
  }
};

const getJob: Endpoint = {
  path: "/content/v1/jobs/:id",
  method: "get",
  handler: async (req) => {
    const denied = requireScope(req, "jobs:read");
    if (denied) return denied;
    const id = String(req.routeParams?.id ?? "");
    if (!id) return Response.json({ error: { code: "JOB_NOT_FOUND" } }, { status: 404 });
    try {
      const job = await req.payload.findByID({ collection: "payload-jobs", id, overrideAccess: true });
      const requester = req.user ? `${req.user.collection}:${req.user.id}` : null;
      const canReadAnyJob = hasEditorRole(req, ["admin"]);
      if (!canReadAnyJob && jobOwnerIdentity(job.input) !== requester) {
        return Response.json(
          { error: { code: "JOB_NOT_FOUND", message: "The job does not exist." } },
          { status: 404 }
        );
      }

      return Response.json({
        data: {
          id: job.id,
          taskSlug: job.taskSlug,
          completedAt: job.completedAt,
          hasError: job.hasError,
          taskStatus: job.taskStatus,
          log: sanitizedJobLog(job.log)
        }
      });
    } catch {
      return Response.json({ error: { code: "JOB_NOT_FOUND", message: "The job does not exist." } }, { status: 404 });
    }
  }
};

const getPublished: Endpoint = {
  path: "/content/v1/published",
  method: "get",
  handler: async (req) => {
    const url = new URL(req.url ?? "http://localhost");
    const collectionValue = url.searchParams.get("collection");
    const collection = collectionValue === "pages" || collectionValue === "posts" ? collectionValue : null;
    const localeValue = url.searchParams.get("locale") ?? "en";
    const locale = contentLocales.find((candidate) => candidate === localeValue);
    const slug = url.searchParams.get("slug");
    const requestedPage = Number(url.searchParams.get("page") ?? "1");
    const requestedLimit = Number(url.searchParams.get("limit") ?? "100");
    if (!collection || !locale) {
      return Response.json(
        { error: { code: "INVALID_QUERY", message: "A valid collection and locale are required." } },
        { status: 400 }
      );
    }
    if (
      !Number.isInteger(requestedPage) ||
      requestedPage < 1 ||
      !Number.isInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > 100
    ) {
      return Response.json(
        { error: { code: "INVALID_QUERY", message: "Page and limit must be valid integers." } },
        { status: 400 }
      );
    }

    const result = await req.payload.find({
      collection,
      draft: false,
      locale,
      fallbackLocale: false,
      depth: 2,
      limit: slug ? 1 : requestedLimit,
      page: slug ? 1 : requestedPage,
      overrideAccess: false,
      req,
      where: slug ? { slug: { equals: slug } } : undefined,
      sort: "-publishedAt"
    });
    const documents = result.docs.map((document) =>
      serializePublishedDocument(collection, document as unknown as Record<string, unknown>)
    );
    if (slug && documents.length === 0) {
      return Response.json({ error: { code: "CONTENT_NOT_FOUND" } }, { status: 404 });
    }
    return Response.json(
      slug
        ? { data: documents[0] }
        : {
            data: documents,
            pagination: {
              page: result.page,
              totalPages: result.totalPages,
              totalDocs: result.totalDocs,
              hasNextPage: result.hasNextPage,
              nextPage: result.nextPage
            }
          }
    );
  }
};

export const contentApiEndpoints: Endpoint[] = [
  {
    path: "/content/v1/health",
    method: "get",
    handler: async () => Response.json({ data: { status: "ok", version: "v1" } })
  },
  validateDraft,
  createDraft,
  getDraft,
  updateDraft,
  submitDraft,
  publishDraft,
  createImport,
  createBrief,
  getJob,
  getPublished
];
