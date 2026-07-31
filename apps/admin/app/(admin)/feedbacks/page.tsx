import { AdminPageHeader } from "@admin/components/admin-page-header";
import { AdminStatusBadge } from "@admin/components/admin-status-badge";
import {
  AdminTable,
  AdminTableBody,
  AdminTableCell,
  AdminTableEmpty,
  AdminTableHead,
  AdminTableHeader,
  AdminTableRow,
} from "@admin/components/admin-table";
import { getAdminContext } from "@admin/lib/authz";
import { countAdminFeedbacks, listAdminFeedbacks } from "@admin/lib/data";
import { formatAdminDate } from "@admin/lib/format";
import { Pager } from "@admin/components/pager";

const PAGE_SIZE = 100;

export default async function AdminFeedbacksPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const admin = await getAdminContext();
  if (!admin) {
    return null;
  }

  const { page: rawPage } = await searchParams;
  const page = Math.max(Number.parseInt(rawPage ?? "1", 10) || 1, 1);

  const [rows, total] = await Promise.all([
    listAdminFeedbacks(page, PAGE_SIZE),
    countAdminFeedbacks(),
  ]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Feedback"
        description="Read customer feedback and spot themes worth acting on."
        actions={
          <p className="text-sm text-muted-foreground">Total: {total ?? 0}</p>
        }
      />

      <AdminTable caption="Customer feedback" className="min-w-[64rem]">
        <AdminTableHeader>
          <tr>
            <AdminTableHead>ID</AdminTableHead>
            <AdminTableHead>User</AdminTableHead>
            <AdminTableHead>Rating</AdminTableHead>
            <AdminTableHead>Content</AdminTableHead>
            <AdminTableHead>Status</AdminTableHead>
            <AdminTableHead>Created</AdminTableHead>
          </tr>
        </AdminTableHeader>
        <AdminTableBody>
          {(rows ?? []).length === 0 && (
            <AdminTableEmpty
              colSpan={6}
              title="No feedback yet"
              description="Customer submissions will appear here."
            />
          )}
          {(rows ?? []).map((feedback) => (
            <AdminTableRow key={feedback.id}>
              <AdminTableCell className="font-mono">
                {feedback.id}
              </AdminTableCell>
              <AdminTableCell>
                <div className="font-medium">
                  {(feedback as any).user?.email || "Unknown user"}
                </div>
                <div className="font-mono text-sm text-muted-foreground">
                  {feedback.user_uuid ?? (feedback as any).user?.uuid ?? "—"}
                </div>
              </AdminTableCell>
              <AdminTableCell className="font-medium tabular-nums">
                {feedback.rating ?? "—"}
              </AdminTableCell>
              <AdminTableCell className="max-w-[40rem] whitespace-pre-wrap">
                {feedback.content || "—"}
              </AdminTableCell>
              <AdminTableCell>
                <AdminStatusBadge
                  tone={feedback.status === "resolved" ? "success" : "neutral"}
                >
                  {feedback.status ?? "new"}
                </AdminStatusBadge>
              </AdminTableCell>
              <AdminTableCell className="whitespace-nowrap text-muted-foreground">
                {formatAdminDate(feedback.created_at)}
              </AdminTableCell>
            </AdminTableRow>
          ))}
        </AdminTableBody>
      </AdminTable>

      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={total ?? 0}
        href={(target) => `/feedbacks?page=${target}`}
      />
    </div>
  );
}
