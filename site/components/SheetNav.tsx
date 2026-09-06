import type { ReactElement } from "react";
import Link from "next/link";

/* The sheet's own index. It sits immediately below the colophon strip — that
   is, outside the crop a screenshot takes — so the shareable sheet stays a
   finished citation while the page it came from is still navigable.

   Set in the strip's own mono, at the strip's size and tracking, so it reads
   as one more line of page furniture rather than as a control. Nothing here is
   a button: they are links, underlined by a rule like every other link on the
   sheet. */

export type SheetPage = "number" | "cohorts" | "method" | "card";

const PAGES: { key: SheetPage; href: string; label: string }[] = [
  { key: "number", href: "/", label: "The number" },
  { key: "cohorts", href: "/cohorts", label: "Cohorts" },
  { key: "method", href: "/method", label: "Method" },
  { key: "card", href: "/number", label: "Card" },
];

export function SheetNav({ current }: { current: SheetPage }): ReactElement {
  return (
    <nav className="sheet-nav" aria-label="Sheet">
      {PAGES.filter((p) => p.key !== current).map((p) => (
        <Link key={p.key} href={p.href}>
          {p.label}
        </Link>
      ))}
      <a href="/number.json">number.json</a>
    </nav>
  );
}
