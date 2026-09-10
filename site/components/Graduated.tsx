"use client";

/* /graduated: every graduation, ranked by how long it took to graduate.

   The row list is static — generated at build time into public/graduated.json
   (scripts/generate-graduated.mjs) rather than fetched from the Worker, so
   the page has no API dependency and no cold-start on a launch-day spike
   (TASK, REPOSITION.md build order C).

   Every duration is a Class B fact: one token's own graduation minus its own
   launch. This component sorts the rows it is given — it never computes a
   share, a rate, or a percentage, and it carries no verdict vocabulary.
   CONSTRAINTS 1: a ranking is permitted only when the ranked quantity is
   shown, so the duration column is printed on every row regardless of which
   column the table is currently sorted by. */

import { useMemo, useState, type ReactElement } from "react";
import type { GraduatedFile, GraduatedRow } from "../lib/graduated";
import { formatCount, formatDuration, formatUtcLong, pairLabel } from "../lib/format";

export type GraduatedSortKey = "duration" | "durationDesc" | "graduatedAt" | "pair" | "tax";

export const GRADUATED_SORT_KEYS: GraduatedSortKey[] = [
  "duration",
  "durationDesc",
  "graduatedAt",
  "pair",
  "tax",
];

const SORT_LABEL: Record<GraduatedSortKey, string> = {
  duration: "Fastest first",
  durationDesc: "Slowest first",
  graduatedAt: "Most recently graduated",
  pair: "Pair token",
  tax: "Creator tax",
};

const DEFAULT_SORT: GraduatedSortKey = "duration";

function compareRows(a: GraduatedRow, b: GraduatedRow, sort: GraduatedSortKey): number {
  switch (sort) {
    case "duration":
      return a.durationSeconds - b.durationSeconds;
    case "durationDesc":
      return b.durationSeconds - a.durationSeconds;
    case "graduatedAt":
      return Date.parse(b.graduatedAt) - Date.parse(a.graduatedAt);
    case "pair":
      return (
        (a.pairClass ?? "").localeCompare(b.pairClass ?? "") || a.durationSeconds - b.durationSeconds
      );
    case "tax":
      return (
        (a.creatorTaxBps ?? -1) - (b.creatorTaxBps ?? -1) || a.durationSeconds - b.durationSeconds
      );
    default:
      return 0;
  }
}

/* The tax as the reader's own unit. Every other page on this site says "1%"
   and "2-3%", and a column that says "100 bps" beside them is the same fact
   in a second dialect. Basis points are exact, so the conversion is a unit
   change and not a rounding: a tax is set in whole basis points and 100 of
   them is one percent. A value that is not a whole number of tenths keeps its
   basis points rather than being rounded into a tidier lie. */
function taxCell(bps: number | null): string {
  if (bps === null) return "not read";
  const percent = bps / 100;
  return Number.isInteger(percent * 10) ? `${percent}%` : `${bps} bps`;
}

/* The address, shortened the way worker/src/text.ts shortens it, so the same
   token reads the same on its own page and in this list. The full address is
   the link target and the title, so nothing is lost -- it just stops taking
   half the table's width and pushing the columns a reader came for off the
   right-hand edge. */
function shortAddress(address: string): string {
  return `${address.slice(0, 10)}\u2026${address.slice(-6)}`;
}

function pairCell(pairClass: string | null): string {
  return pairClass === null ? "not read" : pairLabel(pairClass);
}

export function GraduatedBoard({ data }: { data: GraduatedFile }): ReactElement {
  const [sort, setSort] = useState<GraduatedSortKey>(DEFAULT_SORT);

  const rows = useMemo(() => {
    return [...data.rows].sort((a, b) => compareRows(a, b, sort));
  }, [data.rows, sort]);

  return (
    <div className="graduated-board">
      <nav className="sheet-nav live-sort" aria-label="Sort the graduated list">
        {GRADUATED_SORT_KEYS.map((key) =>
          key === sort ? (
            <span key={key} aria-current="true" className="live-sort-current">
              {SORT_LABEL[key]}
            </span>
          ) : (
            <a
              key={key}
              href={`?sort=${key}`}
              onClick={(event) => {
                event.preventDefault();
                setSort(key);
              }}
            >
              {SORT_LABEL[key]}
            </a>
          ),
        )}
      </nav>

      <p className="note note--fine">
        {formatCount(rows.length)} graduated tokens · sorted by {SORT_LABEL[sort]}
      </p>

      <div className="scroller" tabIndex={0} role="group" aria-label="Every graduation, ranked by time to graduate">
        <table>
          <caption>
            One row per graduated token, ranked only by a column printed on the row itself. Time to
            graduate is that token's own graduation minus its own launch.
          </caption>
          <thead>
            <tr>
              <th scope="col">Token</th>
              <th scope="col">Time to graduate</th>
              <th scope="col">Pair</th>
              <th scope="col">Creator tax</th>
              <th scope="col">Graduated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.token}>
                <th scope="row" className="mono">
                  <a href={`/t/${row.token}`} title={row.token}>
                    {shortAddress(row.token)}
                  </a>
                </th>
                <td className="fig n mono">{formatDuration(row.durationSeconds)}</td>
                <td className="fig n">{pairCell(row.pairClass)}</td>
                <td className="fig n">{taxCell(row.creatorTaxBps)}</td>
                <td className="thin">{formatUtcLong(row.graduatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? (
        <p className="note note--fine">No graduation joins to a launch on record yet.</p>
      ) : null}
    </div>
  );
}
