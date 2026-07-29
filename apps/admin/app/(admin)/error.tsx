"use client";

import {
  AdminErrorState,
  type AdminBoundaryError,
} from "@admin/components/admin-error-state";

/**
 * Keeps navigation and operator identity mounted when an admin page fails.
 */
export default function AdminPageError({
  error,
  reset,
}: {
  error: AdminBoundaryError;
  reset: () => void;
}) {
  return <AdminErrorState error={error} reset={reset} embedded />;
}
