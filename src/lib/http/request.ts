import "server-only";

import type { ZodError, ZodTypeAny } from "zod";

import { AppError } from "@/lib/errors/app-error";

type ParseJsonBodyOptions = {
  /**
   * Used when the body is empty. Omit this to require a JSON body.
   */
  defaultValue?: unknown;
  /** Maximum encoded body size. Defaults to 64 KiB. */
  maxBytes?: number;
};

const DEFAULT_JSON_BODY_MAX_BYTES = 64 * 1024;

async function readBodyWithinLimit(
  req: Request,
  maxBytes: number,
): Promise<string> {
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new AppError("REQUEST_BODY_TOO_LARGE", {
      message: `declared request body is ${declaredLength} bytes; limit is ${maxBytes}`,
      details: { maxBytes },
    });
  }

  if (!req.body) return "";

  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new AppError("REQUEST_BODY_TOO_LARGE", {
        message: `streamed request body exceeded ${maxBytes} bytes`,
        details: { maxBytes },
      });
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function validationDetails(error: ZodError) {
  return {
    fields: error.issues.map((issue) => ({
      field: issue.path.join(".") || undefined,
      code: issue.code,
    })),
  };
}

export async function parseJsonBody<Schema extends ZodTypeAny>(
  req: Request,
  schema: Schema,
  options: ParseJsonBodyOptions = {},
): Promise<Schema["_output"]> {
  let text: string;
  try {
    text = await readBodyWithinLimit(
      req,
      options.maxBytes ?? DEFAULT_JSON_BODY_MAX_BYTES,
    );
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new AppError("REQUEST_MALFORMED_JSON", {
      message: "request body could not be read",
      cause,
    });
  }

  let payload: unknown;
  if (text.trim() === "") {
    if ("defaultValue" in options) {
      payload = options.defaultValue;
    } else {
      throw new AppError("REQUEST_MALFORMED_JSON", {
        message: "request body is empty",
      });
    }
  } else {
    try {
      payload = JSON.parse(text);
    } catch (cause) {
      throw new AppError("REQUEST_MALFORMED_JSON", {
        message: "request body is not valid JSON",
        cause,
      });
    }
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError("REQUEST_VALIDATION_FAILED", {
      message: parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<body>"}: ${issue.message}`)
        .join("; "),
      details: validationDetails(parsed.error),
    });
  }

  return parsed.data;
}
