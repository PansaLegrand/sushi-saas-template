import { requireAdminRead } from "@admin/lib/authz";
import { respData, respErr } from "@/lib/resp";
import { countAdminPaidOrders, listAdminPaidOrders } from "@admin/lib/data";

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
      listAdminPaidOrders(page, limit),
      countAdminPaidOrders(),
    ]);

    return respData({
      items: rows ?? [],
      page,
      limit,
      total: total ?? 0,
    });
  } catch (e) {
    console.error("admin list orders failed", e);
    return respErr("admin list orders failed", { status: 500 });
  }
}
