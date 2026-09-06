"use client";

import { useEffect, useState } from "react";

export interface Freshness {
  /** seconds since crawledAt, or null before the first client tick and
      whenever crawledAt is not a timestamp a clock can read */
  ageSeconds: number | null;
  /** crawledAt could not be parsed: the sheet has no idea how old it is */
  unreadable: boolean;
  stale: boolean;
}

/* Static export bakes the HTML, so a relative age can only be honest if the
   browser computes it. Before the first tick the caller renders the absolute
   UTC timestamp instead: the static HTML never claims a freshness it cannot
   know.

   A crawledAt the clock cannot read is treated as stale, never as fresh and
   never as an age. Date.parse returns NaN there, and NaN propagates silently
   through arithmetic and comparison alike: `NaN >= staleAfterSeconds` is false,
   so an unguarded age would render a measurement of unknown vintage as fresh,
   and print it as "NaN d ago". The schema already refuses such a file at build
   time; this is the same refusal at render time. */
export function useFreshness(crawledAt: string, staleAfterSeconds: number): Freshness {
  const unreadable = Number.isNaN(Date.parse(crawledAt));
  const [ageSeconds, setAgeSeconds] = useState<number | null>(null);

  useEffect(() => {
    const crawled = Date.parse(crawledAt);
    if (Number.isNaN(crawled)) return;
    const tick = () => setAgeSeconds(Math.max(0, Math.round((Date.now() - crawled) / 1000)));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [crawledAt]);

  const age = unreadable ? null : ageSeconds;

  return {
    ageSeconds: age,
    unreadable,
    stale: unreadable || (age !== null && age >= staleAfterSeconds),
  };
}
