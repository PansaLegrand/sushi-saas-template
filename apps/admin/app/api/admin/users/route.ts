import { requireAdminRead } from "@admin/lib/authz";
import { respData } from "@/lib/resp";
import { respError } from "@/lib/errors/response";
import { countAdminUsers, listAdminUsers } from "@admin/lib/data";

export async function GET(req: Request) {
  const authz = await requireAdminRead();
  if (authz instanceof Response) return authz;

  try {
    const url = new URL(req.url);
    const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") || "50", 10), 1),
      100
    );
    const query = url.searchParams.get("q")?.trim() || undefined;

    const [rows, total] = await Promise.all([
      listAdminUsers({ query, page, limit }),
      countAdminUsers(query),
    ]);

    return respData({
      items: rows ?? [],
      page,
      limit,
      total,
    });
  } catch (e) {
    return respError(e, {
      logFields: { event: "admin.users_list_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
