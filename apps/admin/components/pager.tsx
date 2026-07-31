import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * The console's pager.
 *
 * One component because there were four hand-rolled copies and four pages with
 * no pager at all, and the copies disagreed: each decided "is there a next page"
 * from `rows.length === limit`, which offers a Next link into an empty page
 * whenever the total is an exact multiple of the page size, and which can never
 * say how much is left.
 *
 * Taking `total` instead fixes both. "Page 3 of 47" is the fact the operator
 * needs — a list that silently ends at its cap tells them nothing is missing,
 * which is the failure this exists to prevent.
 */
export function Pager({
  page,
  pageSize,
  total,
  href,
  unit = "rows",
}: {
  page: number;
  pageSize: number;
  total: number;
  /** Builds the URL for a page, carrying whatever filters the page holds. */
  href: (page: number) => string;
  /** Plural noun for the total, e.g. "entries", "rules". */
  unit?: string;
}) {
  const lastPage = Math.max(Math.ceil(total / pageSize), 1);

  // Nothing to navigate. Rendered as nothing rather than as a disabled control:
  // a pager on a six-row table is furniture.
  if (lastPage <= 1) return null;

  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex flex-col gap-3 border-t border-border pt-4 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-muted-foreground">
        Page {page} of {lastPage} · {total} {unit}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 && (
          <Button asChild variant="outline">
            <Link
              href={href(page - 1)}
              aria-label={`Previous page, page ${page - 1}`}
            >
              Previous
            </Link>
          </Button>
        )}
        {page < lastPage && (
          <Button asChild variant="outline">
            <Link
              href={href(page + 1)}
              aria-label={`Next page, page ${page + 1}`}
            >
              Next
            </Link>
          </Button>
        )}
      </div>
    </nav>
  );
}
