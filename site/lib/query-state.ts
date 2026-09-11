/* Sort, filter and page all live in the query string (REVAMP.md "URL
   state"), following the pattern the boards already used for `?sort=` --
   `history.replaceState`, read once on mount. The one change from that
   original pattern: a write here MERGES into the existing query string
   rather than replacing it outright, because a page now carries several
   independent parameters (sort, page, and per-board filters) that must all
   survive each other's changes -- choosing a sort must not erase a filter,
   and paging forward must not erase either. */

export function readQuery(name: string): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get(name);
  return value === null || value === "" ? null : value;
}

/** A positive integer from the query string, or null when absent or not a
    positive integer -- never NaN, never zero, never negative. */
export function readQueryInt(name: string): number | null {
  const raw = readQuery(name);
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Merges `patch` into the current query string and replaces the address
    bar entry (no history push, matching the boards' existing sort links).
    A null or empty-string value deletes that key rather than writing it. */
export function mergeQuery(patch: Record<string, string | number | null>): void {
  if (typeof window === "undefined") return;
  const search = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") search.delete(key);
    else search.set(key, String(value));
  }
  const qs = search.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : "?");
}
