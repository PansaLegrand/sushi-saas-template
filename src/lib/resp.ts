import { ApiResponseCode, type ApiResponse } from "@/types/api";

function toJsonResponse<T>(
  payload: ApiResponse<T>,
  init?: ResponseInit
): Response {
  const body: ApiResponse<T> = {
    code: payload.code,
    message: payload.message,
  };

  if (payload.data !== undefined) {
    body.data = payload.data;
  }

  return Response.json(body, init);
}

export function respJson<T>(
  code: ApiResponseCode,
  message: string,
  data?: T,
  init?: ResponseInit
): Response {
  return toJsonResponse({ code, message, data }, init);
}

export function respData<T>(data: T, init?: ResponseInit): Response {
  return respJson(ApiResponseCode.Ok, "ok", data, init);
}

export function respOk(init?: ResponseInit): Response {
  return respJson(ApiResponseCode.Ok, "ok", undefined, init);
}

export function respErr(message: string, init?: ResponseInit): Response {
  return respJson(ApiResponseCode.Error, message, undefined, {
    status: init?.status ?? 400,
    headers: init?.headers,
  });
}

export function respNoAuth(message = "no auth"): Response {
  return respJson(ApiResponseCode.Unauthorized, message, undefined, {
    status: 401,
  });
}
