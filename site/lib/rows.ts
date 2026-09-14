import type { RegisterCell, RegisterRow } from "../components/Register";
import type { CohortRow, FirstBuyRow, OutcomeCohortRow, OutcomeMarkRow, WindowData } from "./schema";
import { formatCount, insufficientText, isInsufficient, rateText } from "./format";

/* One place turns a cohort row into a register row, so the denominator column
   and the insufficient rendering cannot diverge between tables. */
export function cohortRegisterRow(label: string, row: CohortRow): RegisterRow {
  return {
    label,
    cells: [
      { text: formatCount(row.launches), kind: "n" },
      { text: formatCount(row.graduations), kind: "n" },
      cohortRateCell(row),
    ],
  };
}

/* A bucket that recorded no graduations has not measured a rate of zero — it
   has measured no graduations. Printing "0.0%" beside "2.16%" invites the
   reader to compare them as findings, when 0 of 244 is statistically
   indistinguishable from the headline rate. The count is what was observed, so
   the count is what the cell prints. The file keeps rate: 0.0; only the
   rendering changes. stats.py applies this same guard to fastShares, with the
   comment "never 0.0, which would read as a measured finding rather than an
   absent one". */
export function cohortRateCell(row: CohortRow): RegisterCell {
  if (!isInsufficient({ rate: row.rate, n: row.launches, insufficient: row.insufficient })
      && row.graduations === 0) {
    return { text: `0 of ${formatCount(row.launches)}`, kind: "thin" };
  }
  return rateCell({ rate: row.rate, n: row.launches, insufficient: row.insufficient });
}

export function cohortFooting(w: WindowData): RegisterRow {
  const noGraduations =
    w.graduations === 0 &&
    !isInsufficient({ rate: w.rate, n: w.launches, insufficient: w.insufficient });
  return {
    label: "All",
    cells: [
      { text: formatCount(w.launches) },
      { text: formatCount(w.graduations) },
      noGraduations
        ? { text: `0 of ${formatCount(w.launches)}`, kind: "thin" }
        : rateCell({ rate: w.rate, n: w.launches, insufficient: w.insufficient }),
    ],
  };
}

/* A rate cell is a figure or it is not a figure, and the running face says
   which. The gate is the shared one, so a table cannot print a percentage the
   fold would refuse to print. */
function rateCell(fact: { rate: number | null; n: number; insufficient?: boolean }): RegisterCell {
  return isInsufficient(fact)
    ? { text: insufficientText(fact.n), kind: "thin" }
    : { text: rateText(fact), kind: "fig" };
}

/** A share of a population, for the launches-per-deployer distribution. An
    empty or under-sampled population has no share: the cell says so rather
    than dividing by zero and printing NaN%. */
export function shareCell(part: number, whole: number): RegisterCell {
  return rateCell({ rate: whole > 0 ? part / whole : null, n: whole });
}

export const COHORT_COLUMNS = (first: string): string[] => [
  first,
  "Launches (n)",
  "Graduations",
  "Rate",
];

/* ---- the pair x tax grid ------------------------------------------------ */

/** The order the 20 cells are printed in, fixed in the source: pair-major,
    then creator tax ascending. It is deliberately not the file's order and
    never the measured order — a table sorted by its own rate reads as a
    ranking, and a ranking of configurations is advice. A bucket the pipeline
    starts publishing that is not named here sorts to the end rather than
    disappearing. */
export const PAIR_ORDER = ["eth", "stable", "stock", "other"];
export const TAX_ORDER = ["0%", "1%", "2-3%", "4-5%", "6-10%"];

function rank(order: string[], bucket: string): number {
  const i = order.indexOf(bucket);
  return i === -1 ? order.length : i;
}

export function pairTaxOrder<T extends { pairClass: string; taxBucket: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      rank(PAIR_ORDER, a.pairClass) - rank(PAIR_ORDER, b.pairClass) ||
      rank(TAX_ORDER, a.taxBucket) - rank(TAX_ORDER, b.taxBucket),
  );
}

/** The grid's column heads. The sample-size column stands beside both rates,
    which is what Register checks for before it builds. */
export const PAIRTAX_COLUMNS = [
  "Pair token",
  "Creator tax",
  "Launches (n)",
  "Graduations",
  "Rate",
  "Excluding fast",
];

/* ---- first-buy timing (A5b) --------------------------------------------- */

/* Short heads (2026-09-14): eight columns must fit a phone's scroller
   without each head wrapping to three lines. "≤ 1 s" reads as the
   cumulative share it is. */
export const FIRSTBUY_COLUMNS = (first: string): string[] => [
  first,
  "Launches (n)",
  "Opening buy in launch tx",
  "Same block",
  "≤ 1 s",
  "≤ 3 s",
  "≤ 5 s",
  "None",
];

/** The cumulative shares stats.py published, each through the same gate as
    every other rate: below n = 30 the cell says so. Nothing is divided here. */
export function firstBuyRegisterRow(label: string, row: FirstBuyRow): RegisterRow {
  const cell = (rate: number | null) => rateCell({ rate, n: row.n, insufficient: row.insufficient });
  return {
    label,
    cells: [
      { text: formatCount(row.n), kind: "n" },
      cell(row.launchTxBuyShare),
      cell(row.sameBlockShare),
      cell(row.within1sShare),
      cell(row.within3sShare),
      cell(row.within5sShare),
      cell(row.noneShare),
    ],
  };
}

/* ---- outcomes after a graduation (A6) ------------------------------------ */

export type OutcomeMark = "1h" | "24h" | "7d";
const OUTCOME_HEAD: Record<OutcomeMark, string> = { "1h": "+1 h, median", "24h": "+24 h, median", "7d": "+7 d, median" };

/** The marks any cohort has reached; the page decides which (a column of
    n = 0 is absent, not printed). */
export const OUTCOME_COLUMNS = (first: string, marks: readonly OutcomeMark[]): string[] => [
  first,
  "Graduations (n)",
  ...marks.map((m) => OUTCOME_HEAD[m]),
  "No trade by +24 h",
];

/** A change against the opening price, as stats.py published it: a signed
    percentage with one decimal and the mark's own n, or the floor sentence.
    Formatting only; the median is the file's. */
function changeCell(mark: OutcomeMarkRow): RegisterCell {
  if (isInsufficient({ rate: mark.median, n: mark.n, insufficient: mark.insufficient }) || mark.median === null) {
    return { text: insufficientText(mark.n), kind: "thin" };
  }
  const sign = mark.median < 0 ? "\u2212" : "+";
  return { text: `${sign}${Math.abs(mark.median * 100).toFixed(1)}% (n=${formatCount(mark.n)})`, kind: "fig" };
}

export function outcomeRegisterRow(label: string, row: OutcomeCohortRow, marks: readonly OutcomeMark[]): RegisterRow {
  const h24 = row.marks["24h"];
  return {
    label,
    cells: [
      { text: formatCount(row.graduations), kind: "n" },
      ...marks.map((m) => changeCell(row.marks[m])),
      rateCell({ rate: h24.noTradeShare, n: h24.n, insufficient: h24.insufficient }),
    ],
  };
}
