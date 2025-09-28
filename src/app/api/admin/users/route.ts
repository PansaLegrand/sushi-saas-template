import { requireAdminRead } from "@/lib/authz";
import { respData, respErr } from "@/lib/resp";
import { getUsers, getUsersTotal } from "@/models/user";

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

    const [rows, total] = await Promise.all([
      getUsers(page, limit),
      getUsersTotal(),
    ]);

    return respData({
      items: rows ?? [],
      page,
      limit,
      total,
    });
  } catch (e) {
    console.error("admin list users failed", e);
    return respErr("admin list users failed");
  }
}

