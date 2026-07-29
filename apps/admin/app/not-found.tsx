import { AdminNotFoundState } from "@admin/components/admin-not-found-state";

/**
 * Handles URLs that do not match any admin route.
 *
 * The authenticated route group has a closer boundary for missing records so
 * the console navigation remains available there.
 */
export default function AdminNotFound() {
  return (
    <main>
      <AdminNotFoundState />
    </main>
  );
}
