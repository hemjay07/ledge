"use client";

import type { ReactElement } from "react";
import { formatAge, formatUtcLong } from "../lib/format";
import { useFreshness } from "./useFreshness";

export interface AgeProps {
  crawledAt: string;
  staleAfterSeconds: number;
  /** prefix printed before the age, e.g. "updated" */
  prefix?: string;
}

export function Age({ crawledAt, staleAfterSeconds, prefix = "updated" }: AgeProps): ReactElement {
  const { ageSeconds, stale, unreadable } = useFreshness(crawledAt, staleAfterSeconds);

  /* A measurement time nothing can read is not an age and is not a date. It
     says so, in the one colour the system spends on a number that is lying
     about its own freshness. */
  if (unreadable) {
    return (
      <span className="age">
        {prefix} at <span className="mono is-stale">an unreadable time</span>
      </span>
    );
  }

  if (ageSeconds === null) {
    return (
      <span className="age">
        {prefix} at <span className="mono">{formatUtcLong(crawledAt)}</span>
      </span>
    );
  }

  return (
    <span className="age">
      {prefix} <span className={stale ? "mono is-stale" : "mono"}>{formatAge(ageSeconds)}</span> ago
    </span>
  );
}
