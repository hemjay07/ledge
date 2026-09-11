/* Page size 50, applied to /graduated, /live and /graveyard alike
   (REVAMP.md pagination). One place holds the number so the three boards
   cannot drift apart on it. */

export const PAGE_SIZE = 50;

export function totalPagesFor(count: number): number {
  return Math.max(1, Math.ceil(count / PAGE_SIZE));
}

/** Clamps a requested page into [1, totalPages], so a stale or hand-edited
    `?page=` in the address bar cannot ask for a page that does not exist. */
export function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), totalPages);
}

export function paginate<T>(rows: readonly T[], page: number): T[] {
  const start = (page - 1) * PAGE_SIZE;
  return rows.slice(start, start + PAGE_SIZE);
}
