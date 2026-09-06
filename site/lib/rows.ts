import type { RegisterCell, RegisterRow } from "../components/Register";
import type { CohortRow, WindowData } from "./schema";
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
