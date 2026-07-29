import { AdminNotFoundState } from "@admin/components/admin-not-found-state";

/**
 * Missing records and explicit `notFound()` calls retain the admin shell.
 */
export default function AdminPageNotFound() {
  return <AdminNotFoundState embedded />;
}
