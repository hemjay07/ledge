"use client";

import type { ReactElement } from "react";
import { useEffect } from "react";
import { formatAge, formatUtcLong } from "../lib/format";
import { useFreshness } from "./useFreshness";

export interface StaleBannerProps {
  crawledAt: string;
  staleAfterSeconds: number;
}

/* The correction slip. It is the first element in the body so that any crop
   which includes the fold also includes the admission.

   The root carries data-stale as well, and the stylesheet reads it: it is what
   paints the age inside the fold caption, so the slip and the caption are
   driven by one flag and cannot disagree about whether the sheet is stale. */
export function StaleBanner({ crawledAt, staleAfterSeconds }: StaleBannerProps): ReactElement {
  const { ageSeconds, stale } = useFreshness(crawledAt, staleAfterSeconds);

  useEffect(() => {
    document.documentElement.dataset.stale = stale ? "true" : "false";
  }, [stale]);

  return (
    <div className="stale-slip" hidden={!stale}>
      <div role="status">{stale ? slipText(crawledAt, ageSeconds) : ""}</div>
    </div>
  );
}

function slipText(crawledAt: string, ageSeconds: number | null): string {
  if (ageSeconds === null) {
    return "This number carries no measurement time a clock can read. Treat this sheet as stale.";
  }
  return `This number is ${formatAge(ageSeconds)} old. Last successful measurement ${formatUtcLong(crawledAt)}.`;
}
