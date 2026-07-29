"use client";

/**
 * Root-segment error boundary.
 *
 * Auth routes and failures outside the authenticated route group land here.
 * Admin pages have a closer boundary that keeps the console shell mounted.
 */

import {
  AdminErrorState,
  type AdminBoundaryError,
} from "@admin/components/admin-error-state";

export default function AdminError({
  error,
  reset,
}: {
  error: AdminBoundaryError;
  reset: () => void;
}) {
  return (
    <main>
      <AdminErrorState error={error} reset={reset} />
    </main>
  );
}
