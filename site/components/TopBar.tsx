"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import Link from "next/link";
import { ADDRESS_PATTERN } from "../lib/api";

/* The shell's top bar: the mark, the one thing a reader can do, and the way
   to everything else.

   WHY THIS EXISTS. Until 2026-09-11 there was no shell at all. `layout.tsx`
   was `<body>{children}</body>` and each of eight pages rendered its own copy
   of the navigation inline, below its own running head. Every destination was
   a full page load, the only action on the site sat halfway down the home
   page, and three independent assessments reached the same conclusion: a
   visitor could not tell what the site offered or do anything with it without
   scrolling first.

   WHAT IT IS NOT. Not a dashboard chrome bolted on for the look of it, and not
   a place for figures. No number appears here, because a number here would
   have no denominator and no window beside it, and CONSTRAINTS 3 applies to
   the shell exactly as it applies to a page.

   THE ADDRESS FIELD. The most common arrival is someone holding a token
   address from a group chat, so the field takes them straight to that token's
   own page. It accepts a bare address or a pasted URL containing one, because
   people copy URLs. It navigates rather than rendering a result, so the token
   page stays the shareable artifact -- burying it in an overlay would throw
   away the thing that gets pasted onward. */

/** Primary destinations: what a reader browses. */
const BROWSE = [
  { href: "/live", label: "Live" },
  { href: "/graduated", label: "Graduated" },
  { href: "/graveyard", label: "Graveyard" },
  /* Its own link, not under Reference: a buyer who followed the pons listing
     here must find the token without a click (REVAMP.md 2026-09-12). */
  { href: "/token", label: "Token" },
] as const;

/** How we know. Behind one disclosure rather than five more links, because
    they matter enormously to someone checking the work and not at all to
    someone deciding whether to stay. Nothing is removed -- everything is one
    click away, which is what CONSTRAINTS 5's reachability rests on. */
const REFERENCE = [
  { href: "/number", label: "The number" },
  { href: "/cohorts", label: "Cohorts" },
  { href: "/cockpit", label: "Pair and tax" },
  { href: "/method", label: "Method" },
  { href: "/number.json", label: "number.json" },
] as const;

export function TopBar(): ReactElement {
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [openReference, setOpenReference] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    /* A bare address, or one inside a pasted URL. The match is taken from
       anywhere in the string so a ponsfamily.com launch link works unchanged. */
    const found = value.match(ADDRESS_PATTERN);
    if (!found) {
      setProblem("That is not a 20-byte address.");
      return;
    }
    setProblem(null);
    window.location.href = `/t/${found[0].toLowerCase()}`;
  }

  return (
    <header className="topbar">
      <div className="topbar-row">
        <Link href="/" className="topbar-mark" aria-label="LEDGE, home">
          LEDGE
        </Link>

        <form className="topbar-find" onSubmit={onSubmit} noValidate>
          <label className="topbar-find-label" htmlFor="topbar-address">
            Look up a token
          </label>
          <input
            id="topbar-address"
            className="topbar-input mono"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste a token address"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (problem !== null) setProblem(null);
            }}
            aria-describedby={problem ? "topbar-problem" : undefined}
          />
          <button className="topbar-go" type="submit">
            Go
          </button>
        </form>

        <nav className="topbar-nav" aria-label="Sections">
          {BROWSE.map((p) => (
            <Link key={p.href} href={p.href}>
              {p.label}
            </Link>
          ))}
          <button
            type="button"
            className="topbar-more"
            aria-expanded={openReference}
            aria-controls="topbar-reference"
            onClick={() => setOpenReference((v) => !v)}
          >
            Reference
          </button>
        </nav>
      </div>

      {problem ? (
        <p className="topbar-problem" id="topbar-problem" role="status">
          {problem}
        </p>
      ) : null}

      {/* Hidden rather than unmounted, so the links are in the document for a
          crawler and for anyone whose JavaScript has not run. */}
      <div className="topbar-reference" id="topbar-reference" hidden={!openReference}>
        {REFERENCE.map((p) => (
          <Link key={p.href} href={p.href}>
            {p.label}
          </Link>
        ))}
      </div>
    </header>
  );
}
