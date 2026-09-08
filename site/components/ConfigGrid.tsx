"use client";

import { useId, useState, type ReactElement } from "react";
import { LedgerEntry } from "./LedgerEntry";
import { Register, type RegisterCell, type RegisterRow } from "./Register";
import { Stat } from "./Stat";
import { formatCount, formatOneIn, isInsufficient, pairLabel, taxLabel } from "../lib/format";
import { PAIRTAX_COLUMNS, pairTaxOrder } from "../lib/rows";
import type { PairTaxRow } from "../lib/schema";

/* The whole grid, always. The two selects mark one row of it; they do not
   sort it, filter it, score it or remove anything from it. Seeing every
   configuration beside the one a reader came for is the honest form: a table
   that answers only the question asked hides the population the answer came
   from.

   The state is a client detail and nothing else is. Both tables are printed
   in full in the static HTML with nothing selected, so a reader with no
   JavaScript reads exactly the same 20 rows in exactly the same order. */

export interface GridTotals {
  launches: number;
  graduations: number;
  rate: number | null;
  insufficient: boolean;
  excludingFast: {
    graduations: number;
    rate: number | null;
    oneIn: number | null;
    insufficient: boolean;
  };
}

export interface GridWindow {
  key: string;
  /** the window, as every Stat on the page names it: "24 h" / "all-time" */
  label: string;
  folio: string;
  heading: string;
  headingNote: string;
  caption: string;
  ariaLabel: string;
  note: string | null;
  rows: PairTaxRow[];
  total: GridTotals;
}

export interface ConfigGridProps {
  windows: GridWindow[];
  crawledAt: string;
  /** folio of the entry holding the two controls */
  folio: string;
}

interface RateFact {
  value: number | null;
  n: number;
  graduations: number;
  insufficient: boolean;
  name: string;
  window: string;
  updatedAt: string;
  oneIn?: number | null;
  /* The column head this cell answers to, printed only on a sheet too narrow
     to carry column heads. Six columns do not fit a 390px measure, so each row
     reflows to two lines there and every figure states what it is in place of
     the head it lost. Nothing is dropped and nothing is truncated. */
  narrowLabel?: string;
}

/* Every rate on this page goes through Stat, so a cell the sample cannot
   support prints "not enough data (n=…)" and there is no path from a null to
   a percentage. The one cell Stat does not draw is a bucket that recorded no
   graduations: METHOD prints the count it observed ("0 of 244") rather than
   "0.0%", which would read as a measured finding rather than an absent one. */
function rateCell(fact: RateFact): RegisterCell {
  const gated = isInsufficient({ rate: fact.value, n: fact.n, insufficient: fact.insufficient });
  const label = fact.narrowLabel ? (
    <span className="at-narrow">{fact.narrowLabel} </span>
  ) : null;

  if (!gated && fact.graduations === 0) {
    return {
      kind: "thin",
      node: (
        <>
          {label}
          {`0 of ${formatCount(fact.n)}`}
        </>
      ),
    };
  }

  const stat = (
    <Stat
      name={fact.name}
      value={fact.value}
      n={fact.n}
      window={fact.window}
      updatedAt={fact.updatedAt}
      insufficient={fact.insufficient}
    />
  );

  return {
    kind: gated ? "thin" : "fig",
    node: (
      <>
        {label}
        {stat}
        {gated || fact.oneIn === null || fact.oneIn === undefined ? null : (
          <>
            {" · "}
            <span className="qty">{formatOneIn(fact.oneIn)}</span>
          </>
        )}
      </>
    ),
  };
}

function gridRow(
  row: PairTaxRow,
  w: GridWindow,
  crawledAt: string,
  picked: boolean,
): RegisterRow {
  return {
    label: pairLabel(row.pairClass),
    labelNode: (
      <>
        {pairLabel(row.pairClass)}
        <span className="at-narrow"> ·</span>
      </>
    ),
    id: `${w.key}/${row.bucket}`,
    picked,
    cells: [
      { text: taxLabel(row.taxBucket), kind: "fig" },
      {
        kind: "n",
        node: (
          <>
            <span className="at-narrow">n = </span>
            {formatCount(row.launches)}
          </>
        ),
      },
      {
        kind: "n",
        node: (
          <>
            {formatCount(row.graduations)}
            <span className="at-narrow"> graduated</span>
          </>
        ),
      },
      rateCell({
        value: row.rate,
        n: row.launches,
        graduations: row.graduations,
        insufficient: row.insufficient,
        name: `pairtax-rate-${w.key}-${row.bucket}`,
        window: w.label,
        updatedAt: crawledAt,
        narrowLabel: "all graduations",
      }),
      rateCell({
        value: row.excludingFast.rate,
        n: row.launches,
        graduations: row.excludingFast.graduations,
        insufficient: row.excludingFast.insufficient,
        name: `pairtax-excluding-fast-${w.key}-${row.bucket}`,
        window: w.label,
        updatedAt: crawledAt,
        oneIn: row.excludingFast.oneIn,
      }),
    ],
  };
}

/* The All footing: how a reader checks the 20 cells against the population
   the rest of the site reports. It carries the window's own totals, so a
   launch with no cell is visible as the difference and is counted in the note
   beneath the table. */
function footing(w: GridWindow, crawledAt: string): RegisterRow {
  return {
    label: "All",
    cells: [
      { text: "" },
      {
        node: (
          <>
            <span className="at-narrow">n = </span>
            {formatCount(w.total.launches)}
          </>
        ),
      },
      {
        node: (
          <>
            {formatCount(w.total.graduations)}
            <span className="at-narrow"> graduated</span>
          </>
        ),
      },
      rateCell({
        value: w.total.rate,
        n: w.total.launches,
        graduations: w.total.graduations,
        insufficient: w.total.insufficient,
        name: `pairtax-all-rate-${w.key}`,
        window: w.label,
        updatedAt: crawledAt,
        narrowLabel: "all graduations",
      }),
      rateCell({
        value: w.total.excludingFast.rate,
        n: w.total.launches,
        graduations: w.total.excludingFast.graduations,
        insufficient: w.total.excludingFast.insufficient,
        name: `pairtax-all-excluding-fast-${w.key}`,
        window: w.label,
        updatedAt: crawledAt,
        oneIn: w.total.excludingFast.oneIn,
      }),
    ],
  };
}

function distinct(rows: PairTaxRow[], key: "pairClass" | "taxBucket"): string[] {
  const seen: string[] = [];
  for (const r of pairTaxOrder(rows)) if (!seen.includes(r[key])) seen.push(r[key]);
  return seen;
}

export function ConfigGrid({ windows, crawledAt, folio }: ConfigGridProps): ReactElement {
  const pairId = useId();
  const taxId = useId();
  const [pair, setPair] = useState("");
  const [tax, setTax] = useState("");

  const first = windows[0]?.rows ?? [];
  const pairs = distinct(first, "pairClass");
  const taxes = distinct(first, "taxBucket");
  const marked = pair !== "" && tax !== "";

  return (
    <>
      <LedgerEntry
        folio={folio}
        id="h-pick"
        heading="A configuration"
        headingNote="· marks a row"
      >
        <div className="picker">
          <p className="picker-field">
            <label className="picker-label" htmlFor={pairId}>
              Pair token
            </label>
            <span className="picker-line">
              <select
                className="picker-select mono"
                id={pairId}
                value={pair}
                onChange={(e) => setPair(e.target.value)}
              >
                <option value="">Not selected</option>
                {pairs.map((p) => (
                  <option key={p} value={p}>
                    {pairLabel(p)}
                  </option>
                ))}
              </select>
              <span className="picker-caret" aria-hidden="true">
                ▾
              </span>
            </span>
          </p>
          <p className="picker-field">
            <label className="picker-label" htmlFor={taxId}>
              Creator tax
            </label>
            <span className="picker-line">
              <select
                className="picker-select mono"
                id={taxId}
                value={tax}
                onChange={(e) => setTax(e.target.value)}
              >
                <option value="">Not selected</option>
                {taxes.map((t) => (
                  <option key={t} value={t}>
                    {taxLabel(t)}
                  </option>
                ))}
              </select>
              <span className="picker-caret" aria-hidden="true">
                ▾
              </span>
            </span>
          </p>
        </div>
        <p className="note note--fine" aria-live="polite">
          {marked
            ? `Marked in every table below: ${pairLabel(pair)}, creator tax ${taxLabel(tax)}. The rows, and their order, are unchanged.`
            : "A row is marked when both a pair token and a creator tax are selected. Every row stays printed either way."}
        </p>
      </LedgerEntry>

      <div className="config-grids">
        {windows.map((w) => (
          <Register
            key={w.key}
            folio={w.folio}
            heading={w.heading}
            headingId={`h-grid-${w.key}`}
            headingNote={w.headingNote}
            ariaLabel={w.ariaLabel}
            caption={w.caption}
            columns={PAIRTAX_COLUMNS}
            rows={pairTaxOrder(w.rows).map((r) =>
              gridRow(r, w, crawledAt, marked && r.pairClass === pair && r.taxBucket === tax),
            )}
            foot={footing(w, crawledAt)}
            note={w.note}
          />
        ))}
      </div>
    </>
  );
}
