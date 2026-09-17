"use client";

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

/* A table wider than the screen scrolls sideways inside `.scroller`, and
   nothing said so: on a phone the /cohorts columns that carry the finding
   (the +24 h median, the within-1-second share) sat off screen behind a
   hard edge (2026-09-17). This wrapper measures the overflow and, only when
   there is some, prints one line under the table saying so. It goes quiet
   once the reader has scrolled to the end. Without JavaScript the table
   still scrolls; only the hint is missing. */
export function Scroller({
  ariaLabel,
  children,
}: {
  ariaLabel: string;
  children: ReactNode;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<"none" | "more">("none");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const overflow = el.scrollWidth - el.clientWidth;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      setHint(overflow > 8 && !atEnd ? "more" : "none");
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
  }, []);

  return (
    <>
      <div ref={ref} className="scroller" tabIndex={0} role="group" aria-label={ariaLabel}>
        {children}
      </div>
      {hint === "more" ? (
        <p className="note note--fine scroller-hint" aria-hidden="true">
          More columns to the right. Scroll the table sideways.
        </p>
      ) : null}
    </>
  );
}
