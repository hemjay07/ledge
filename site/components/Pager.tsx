"use client";

/* Shared by /graduated, /live and /graveyard (page size 50, lib/paginate.ts).
   Same ruled-index vocabulary as .sheet-nav and .live-sort -- plain links,
   not a control panel -- and the position is stated in words rather than
   left to be inferred from which arrows are enabled: "page 3 of 51" is the
   thing that keeps a slice from reading as the whole record. */

import type { ReactElement } from "react";

export function Pager({
  page,
  totalPages,
  onChange,
  label,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  label: string;
}): ReactElement | null {
  if (totalPages <= 1) return null;

  return (
    <nav className="sheet-nav pager" aria-label={label}>
      {page > 1 ? (
        <a
          href={`?page=${page - 1}`}
          onClick={(event) => {
            event.preventDefault();
            onChange(page - 1);
          }}
        >
          Previous
        </a>
      ) : (
        <span className="pager-disabled" aria-disabled="true">
          Previous
        </span>
      )}
      <span className="pager-position mono">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <a
          href={`?page=${page + 1}`}
          onClick={(event) => {
            event.preventDefault();
            onChange(page + 1);
          }}
        >
          Next
        </a>
      ) : (
        <span className="pager-disabled" aria-disabled="true">
          Next
        </span>
      )}
    </nav>
  );
}
