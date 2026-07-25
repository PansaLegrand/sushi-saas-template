import "server-only";

import type { ZodError, ZodTypeAny } from "zod";

import { AppError } from "@/lib/errors/app-error";

type ParseJsonBodyOptions = {
  /**
   * Used when the body is empty. Omit this to require a JSON body.
   */
  defaultValue?: unknown;
};

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
  options: ParseJsonBodyOptions = {}
): Promise<Schema["_output"]> {
  let text: string;
  try {
    text = await req.text();
  } catch (cause) {
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
