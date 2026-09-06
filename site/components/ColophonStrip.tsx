import type { ReactElement, ReactNode } from "react";

/* The signature element. Cropped anywhere between the heavy rule opening the
   fold and the heavy rule under this strip, a phone screenshot is already a
   complete citation. Order is not negotiable: mid rule, strip, heavy rule. */
export function ColophonStrip({ stamp }: { stamp: ReactNode }): ReactElement {
  return (
    <>
      <div className="rule-mid" />
      <div className="colophon">
        <span className="mark">LEDGE.TOOLS</span>
        <span className="stamp">{stamp}</span>
      </div>
      <div className="rule-heavy" />
    </>
  );
}

/* The Ruled L. Three rules taken from the register: the folio margin rule
   standing as the vertical, the total rule as the heavy horizontal, and the
   accountant's double rule for a sum beneath it. The empty upper-right
   quadrant is the drop.

   It is inlined rather than loaded from public/logo.svg so it can be drawn in
   currentColor: one mark that inverts with the sheet, instead of two files and
   a media query deciding which to request. The geometry is logo.svg's,
   unchanged. It is decorative here — the wordmark beside it carries the
   name — so it is hidden from assistive technology. */
function RuledL(): ReactElement {
  return (
    <svg className="ruled-l" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="10.12" height="92" />
      <rect x="4" y="61.04" width="92" height="20.24" />
      <rect x="4" y="84.5" width="92" height="4.14" />
      <rect x="4" y="91.86" width="92" height="4.14" />
    </svg>
  );
}

/* The same strip run as a head, opening the sheet, with the mark set into it. */
export function RunningHead({ mark, win }: { mark: string; win: ReactNode }): ReactElement {
  return (
    <header>
      <div className="rule-heavy" />
      <div className="head">
        <span className="mark">
          <RuledL />
          <span className="wordmark">{mark}</span>
        </span>
        <span className="win">{win}</span>
      </div>
      <div className="rule-hair" />
    </header>
  );
}
