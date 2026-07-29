/**
 * The console's pager.
 *
 * Worth testing for one reason: the four hand-rolled versions it replaced all
 * decided "is there a next page" from `rows.length === pageSize`, which offers a
 * Next link into an empty page whenever the total divides evenly. That bug is
 * invisible until a table happens to hold exactly 50 rows, so it is asserted
 * here rather than left to be noticed.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Pager } from "@admin/components/pager";

const href = (page: number) => `/things?page=${page}`;

describe("Pager", () => {
  it("renders nothing when everything fits on one page", () => {
    // A pager on a six-row table is furniture.
    const { container } = render(
      <Pager page={1} pageSize={50} total={6} href={href} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the total exactly fills one page", () => {
    render(<Pager page={1} pageSize={50} total={50} href={href} />);

    expect(
      screen.queryByRole("link", { name: /^Next page/ })
    ).not.toBeInTheDocument();
  });

  it("offers no Next on the last page when the total divides evenly", () => {
    // The bug in every version this replaced: page 2 of 100 rows at 50 a page
    // held exactly `pageSize` rows, so Next appeared and led nowhere.
    render(<Pager page={2} pageSize={50} total={100} href={href} />);

    expect(screen.getByText("Page 2 of 2 · 100 rows")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^Next page/ })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /^Previous page/ })
    ).toBeInTheDocument();
  });

  it("says how many pages there are, not just which one you are on", () => {
    // The complaint this fixes: a list that stops at its cap looks complete.
    render(<Pager page={3} pageSize={50} total={2_310} href={href} />);

    expect(screen.getByText("Page 3 of 47 · 2310 rows")).toBeInTheDocument();
  });

  it("offers no Previous on the first page", () => {
    render(<Pager page={1} pageSize={50} total={200} href={href} />);

    expect(
      screen.queryByRole("link", { name: /^Previous page/ })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Next page/ })).toHaveAttribute(
      "href",
      "/things?page=2"
    );
  });

  it("carries the caller's filters through both links", () => {
    // Losing a search term on page 2 is how an operator ends up re-typing it.
    render(
      <Pager
        page={2}
        pageSize={20}
        total={100}
        href={(page) => `/users?q=ann&page=${page}`}
      />
    );

    expect(screen.getByRole("link", { name: /^Previous page/ })).toHaveAttribute(
      "href",
      "/users?q=ann&page=1"
    );
    expect(screen.getByRole("link", { name: /^Next page/ })).toHaveAttribute(
      "href",
      "/users?q=ann&page=3"
    );
  });

  it("still offers a way back from a page past the end", () => {
    // Reachable by editing the URL. An empty table with no Previous is a dead
    // end that reads like the data is gone.
    render(<Pager page={9} pageSize={50} total={100} href={href} />);

    expect(
      screen.getByRole("link", { name: /^Previous page/ })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^Next page/ })
    ).not.toBeInTheDocument();
  });

  it("names the rows when the caller says what they are", () => {
    render(
      <Pager page={1} pageSize={50} total={120} unit="entries" href={href} />
    );

    expect(screen.getByText("Page 1 of 3 · 120 entries")).toBeInTheDocument();
  });
});
