/* Page size 50, applied to /graduated, /live and /graveyard alike
   (REVAMP.md pagination). One place holds the number so the three boards
   cannot drift apart on it. */

/* Twenty, down from fifty on 2026-09-12.

   Fifty was sized for a table, where a row is one line and fifty rows is a
   screen and a half. On a phone the same board is a stack of cards, each about
   200 px, and fifty of those is ten thousand pixels: the "unending scroll" the
   owner reported on a page that had supposedly been paginated. It had been.
   The page was just too big to notice. Twenty keeps the table comfortable and
   brings a phone page down to something a thumb can get through. */
export const PAGE_SIZE = 20;

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
