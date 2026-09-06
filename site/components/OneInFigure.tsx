import type { ReactElement } from "react";
import { Figure } from "./Figure";
import { Stat } from "./Stat";
import { isInsufficient } from "../lib/format";

export interface OneInFigureProps {
  /** the restatement the pipeline wrote, or null when it wrote none */
  oneIn: number | null;
  /** the rate the restatement restates, set beside it at the second size */
  value: number | null;
  n: number;
  window: string;
  updatedAt: string;
  insufficient?: boolean;
  name: string;
  /** the full sentence a screen reader hears, denominator included */
  accessibleText: string;
}

/* The poster figure in its "1 in N" face: the count set at poster size in the
   display face, the percentage it restates beside it at the second size, so
   the reader is never handed the restatement without the rate.

   A restatement of a rate that may not be printed is not a figure. When the
   sample does not support the rate, or the pipeline wrote no N, this renders
   exactly what the poster renders in that case — "not enough data (n=…)" —
   and never a bare "1 in". */
export function OneInFigure({
  oneIn,
  accessibleText,
  ...stat
}: OneInFigureProps): ReactElement {
  const fact = { rate: stat.value, n: stat.n, insufficient: stat.insufficient };

  if (oneIn === null || isInsufficient(fact)) {
    return <Figure {...stat} accessibleText={accessibleText} />;
  }

  return (
    <>
      <span aria-hidden="true" className="one-in">
        <Stat {...stat} value={oneIn} format="oneIn" className="figure" />
        <Stat {...stat} name={`${stat.name}-rate`} className="figure-2" />
      </span>
      <span className="vh">{accessibleText}</span>
    </>
  );
}
