import type { ReactElement } from "react";
import {
  INSUFFICIENT_BELOW,
  formatCount,
  formatDuration,
  formatOneIn,
  formatRate,
  insufficientText,
} from "../lib/format";

export type StatFormat = "percent" | "oneIn" | "duration" | "count";

/* The denominator rule, made a type error first and a runtime throw second.
   n, window and updatedAt are not optional and carry no defaults: a figure
   that cannot name its sample size, its window and its measurement does not
   render at all. */
export interface StatProps {
  value: number | null;
  n: number;
  window: string;
  updatedAt: string;
  insufficient?: boolean;
  precision?: number;
  format?: StatFormat;
  /** identifier written to data-stat, for the audit trail in the markup */
  name?: string;
  className?: string;
  /** overrides the generated aria-label; must still name the denominator */
  accessibleName?: string;
}

function required(props: StatProps): void {
  const missing: string[] = [];
  if (typeof props.n !== "number" || !Number.isFinite(props.n)) missing.push("n");
  if (!props.window) missing.push("window");
  if (!props.updatedAt) missing.push("updatedAt");
  if (missing.length > 0) {
    throw new Error(
      `LEDGE: stat "${props.name ?? "unnamed"}" is missing ${missing.join(", ")}. ` +
        "A number does not render without its denominator.",
    );
  }
}

export function formatStatValue(
  value: number,
  format: StatFormat,
  n: number,
  precision?: number,
): string {
  switch (format) {
    case "percent":
      return formatRate(value, n, precision);
    case "oneIn":
      return formatOneIn(value);
    case "duration":
      return formatDuration(value);
    case "count":
      return formatCount(value);
  }
}

export function Stat(props: StatProps): ReactElement {
  required(props);

  const {
    value,
    n,
    window: statWindow,
    updatedAt,
    insufficient,
    precision,
    format = "percent",
    name,
    className,
    accessibleName,
  } = props;

  const isInsufficient = insufficient === true || value === null || n < INSUFFICIENT_BELOW;

  if (isInsufficient) {
    return (
      <span
        className={className ? `insufficient ${className}` : "insufficient"}
        data-stat={name}
        data-n={n}
        data-window={statWindow}
        data-updated={updatedAt}
        data-insufficient="true"
      >
        {insufficientText(n)}
      </span>
    );
  }

  const text = formatStatValue(value as number, format, n, precision);

  /* The percent sign is marked up so the poster figures can set it at its own
     size. At full display size Anton's % is nearly as wide as the digits and
     reads as a third group of numerals rather than as a unit. Everywhere else
     the span carries no rule and the sign stays exactly as it was. */
  const body =
    format === "percent" && text.endsWith("%") ? (
      <>
        {text.slice(0, -1)}
        <span className="pct">%</span>
      </>
    ) : (
      text
    );

  return (
    <span
      className={className}
      data-stat={name}
      data-n={n}
      data-window={statWindow}
      data-updated={updatedAt}
      aria-label={accessibleName ?? `${text} of ${formatCount(n)}, ${statWindow}`}
    >
      {body}
    </span>
  );
}
