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
      rateCell({ rate: row.rate, n: row.launches, insufficient: row.insufficient }),
    ],
  };
}

export function cohortFooting(w: WindowData): RegisterRow {
  return {
    label: "All",
    cells: [
      { text: formatCount(w.launches) },
      { text: formatCount(w.graduations) },
      rateCell({ rate: w.rate, n: w.launches, insufficient: w.insufficient }),
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
