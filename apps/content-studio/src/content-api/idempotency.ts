import { createHash } from "node:crypto";
import type { PayloadRequest } from "payload";
import type { AutomationRequest } from "@/payload-types";

type StoredResponse = {
  id: AutomationRequest["id"];
  statusCode: number;
  response: AutomationRequest["response"];
  requestHash: string;
};

export type ReplayReservation =
  | { id: AutomationRequest["id"]; response?: never }
  | { id?: never; response: Response };

const PROCESSING_STATUS = 102;

export function requestHash(operation: string, body: unknown): string {
  return createHash("sha256").update(`${operation}\n${JSON.stringify(body)}`).digest("hex");
}

export function idempotencyKey(req: PayloadRequest): string | null {
  const value = req.headers.get("idempotency-key")?.trim();
  return value && value.length <= 200 ? value : null;
}

function requestIdentity(req: PayloadRequest): string {
  return req.user ? `${req.user.collection}:${req.user.id}` : "anonymous";
}

export function scopedIdempotencyKey(identity: string, key: string): string {
  return createHash("sha256").update(`${identity}\n${key}`).digest("hex");
}

function replayResponse(stored: StoredResponse, hash: string): Response {
  if (stored.requestHash !== hash) {
    return Response.json(
      {
        error: {
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "This idempotency key was already used for a different request."
        }
      },
      { status: 409 }
    );
  }

  if (stored.statusCode === PROCESSING_STATUS) {
    return Response.json(
      {
        error: {
          code: "IDEMPOTENCY_REQUEST_IN_PROGRESS",
          message: "A request with this idempotency key is still being processed."
        }
      },
      { status: 409, headers: { "retry-after": "2" } }
    );
  }

  return Response.json(stored.response, { status: stored.statusCode });
}

async function findStoredResponse(
  req: PayloadRequest,
  storageKey: string,
  hash: string
): Promise<Response | null> {
  const result = await req.payload.find({
    collection: "automation-requests",
    where: { idempotencyKey: { equals: storageKey } },
    limit: 1,
    overrideAccess: true
  });
  const stored = result.docs[0] as unknown as StoredResponse | undefined;
  if (!stored) return null;
  return replayResponse(stored, hash);
}

export async function reserveReplay(
  req: PayloadRequest,
  key: string,
  hash: string,
  operation: string
): Promise<ReplayReservation> {
  const identity = requestIdentity(req);
  const storageKey = scopedIdempotencyKey(identity, key);
  const existing = await findStoredResponse(req, storageKey, hash);
  if (existing) return { response: existing };

  try {
    const reservation = await req.payload.create({
      collection: "automation-requests",
      data: {
        idempotencyKey: storageKey,
        requestHash: hash,
        operation,
        identity,
        statusCode: PROCESSING_STATUS,
        response: { error: { code: "IDEMPOTENCY_REQUEST_IN_PROGRESS" } }
      },
      overrideAccess: true,
      req
    });
    return { id: reservation.id };
  } catch (error) {
    // A concurrent request may have won the unique-key race after our read.
    const raced = await findStoredResponse(req, storageKey, hash);
    if (raced) return { response: raced };
    throw error;
  }
}

export async function completeReplay({
  req,
  id,
  statusCode,
  response
}: {
  req: PayloadRequest;
  id: AutomationRequest["id"];
  statusCode: number;
  response: AutomationRequest["response"];
}): Promise<void> {
  await req.payload.update({
    collection: "automation-requests",
    id,
    data: { statusCode, response },
    overrideAccess: true,
    req
  });
}

export async function releaseReplay(
  req: PayloadRequest,
  id: AutomationRequest["id"]
): Promise<void> {
  try {
    await req.payload.delete({
      collection: "automation-requests",
      id,
      overrideAccess: true,
      req
    });
  } catch (error) {
    req.payload.logger.error(
      { err: error, automationRequestId: id },
      "Unable to release failed API idempotency reservation"
    );
  }
}
