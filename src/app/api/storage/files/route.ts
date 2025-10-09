import { respData, respErr, respNoAuth } from "@/lib/resp";
import { getUserUuid } from "@/services/user";
import { listFilesByUser } from "@/models/file";

export async function GET(req: Request) {
  try {
    const userUuid = await getUserUuid(req);
    if (!userUuid) return respNoAuth();

    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") || "1");
    const limit = Number(url.searchParams.get("limit") || "50");

    const rows = await listFilesByUser(userUuid, Math.max(page, 1), Math.max(limit, 1));
    return respData({ items: rows });
  } catch (error) {
    console.error("list files failed", error);
    return respErr("list files failed");
  }
}

