import type { ReactElement } from "react";
import { Stat, type StatFormat } from "./Stat";

export interface FigureProps {
  value: number | null;
  n: number;
  window: string;
  updatedAt: string;
  insufficient?: boolean;
  precision?: number;
  format?: StatFormat;
  name: string;
  /** the full sentence a screen reader hears, denominator included */
  accessibleText: string;
  variant?: "primary" | "secondary";
}

/* The poster figure. The only place the display face appears. It is hidden
   from assistive technology and paired with a spelled-out sentence, because
   "1.85%" read aloud is a number without its denominator. */
export function Figure({
  variant = "primary",
  accessibleText,
  ...stat
}: FigureProps): ReactElement {
  return (
    <>
      <span aria-hidden="true">
        <Stat {...stat} className={variant === "primary" ? "figure" : "figure-2"} />
      </span>
      <span className="vh">{accessibleText}</span>
    </>
  );
}
