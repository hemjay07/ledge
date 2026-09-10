import type { ReactElement } from "react";
import Link from "next/link";

/* The sheet's own index. It sits immediately below the colophon strip — that
   is, outside the crop a screenshot takes — so the shareable sheet stays a
   finished citation while the page it came from is still navigable.

   Set in the strip's own mono, at the strip's size and tracking, so it reads
   as one more line of page furniture rather than as a control. Nothing here is
   a button: they are links, underlined by a rule like every other link on the
   sheet. */

export type SheetPage =
  | "home"
  | "live"
  | "graveyard"
  | "graduated"
  | "cohorts"
  | "cockpit"
  | "method"
  | "card";

/* Two groups, not one flat list of nine.

   A visitor arriving from a link wants one of three things: what is happening
   now, what has already happened, or what died. The other five entries -- the
   number and its card, the cohorts, the pair-and-tax grid, the method, the raw
   file -- are how we know, and they matter enormously to a person checking our
   work and not at all to a person deciding whether to stay. A flat list made a
   reader read nine labels and sort them themselves.

   Nothing is removed. Both groups are in the same nav, in the same type, one
   after the other with a separator between them, so everything is still one
   click away and the reachability CONSTRAINTS 5 depends on is untouched. */
const BROWSE: { key: SheetPage; href: string; label: string }[] = [
  { key: "home", href: "/", label: "Home" },
  { key: "live", href: "/live", label: "Live board" },
  { key: "graduated", href: "/graduated", label: "Graduated" },
  { key: "graveyard", href: "/graveyard", label: "The graveyard" },
];

/* "Configurations" named the page after its own internal noun rather than
   after what a reader would look for on it, which is the pair token crossed
   with the creator tax. The page's own heading and every published definition
   are unchanged: this is a signpost, not a definition, so CONSTRAINTS 9 is not
   engaged. */
const EVIDENCE: { key: SheetPage; href: string; label: string }[] = [
  { key: "card", href: "/number", label: "The number" },
  { key: "cohorts", href: "/cohorts", label: "Cohorts" },
  { key: "cockpit", href: "/cockpit", label: "Pair and tax" },
  { key: "method", href: "/method", label: "Method" },
];

export function SheetNav({ current }: { current: SheetPage }): ReactElement {
  return (
    <nav className="sheet-nav" aria-label="Sheet">
      {BROWSE.filter((p) => p.key !== current).map((p) => (
        <Link key={p.key} href={p.href}>
          {p.label}
        </Link>
      ))}
      <span className="sheet-nav-split" aria-hidden="true" />
      {EVIDENCE.filter((p) => p.key !== current).map((p) => (
        <Link key={p.key} href={p.href}>
          {p.label}
        </Link>
      ))}
      <a href="/number.json">number.json</a>
    </nav>
  );
}
