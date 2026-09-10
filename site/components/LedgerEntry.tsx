import type { ReactElement, ReactNode } from "react";

export interface LedgerEntryProps {
  /** folio number in the margin, e.g. "04". Omitted on the front door
      (app/page.tsx), which does not number its entries: the rule ladder
      still carries the eye, and attr(data-folio) prints nothing when the
      attribute is absent. */
  folio?: string;
  heading: string;
  /** the entry's own denominator, printed beside the heading */
  headingNote?: ReactNode;
  id: string;
  children: ReactNode;
}

export function LedgerEntry({
  folio,
  heading,
  headingNote,
  id,
  children,
}: LedgerEntryProps): ReactElement {
  return (
    <section className="entry" data-folio={folio} aria-labelledby={id}>
      <h2 className="label" id={id}>
        {heading}
        {headingNote ? <span className="n"> {headingNote}</span> : null}
      </h2>
      {children}
    </section>
  );
}
