"use client";

import { useEffect, useState, type ReactNode, type ReactElement } from "react";

/* One register at a time, instead of ten stacked in one document.

   WHY. `/cohorts` printed every cut of the Number — pair token, creator tax,
   hour, day, launches per deployer — for both published windows, one after
   another. Ten tables in a single scroll, about 4,800 px on a phone, with no
   way to reach the one you wanted except to scroll past the others. `/cockpit`
   has the same shape. A reader looking for the tax breakdown had to know it
   was fourth.

   WHAT THIS IS NOT. It is not a way of showing less. Every register is still
   on the page, still rendered, still in the document for a crawler and for a
   reader whose JavaScript has not run — they are hidden with the `hidden`
   attribute rather than unmounted, which is the same choice the shell makes
   for its reference links. CONSTRAINTS 5 is about a figure being reachable,
   and a tab is a shorter path to it than a scroll, not a longer one.

   The selected tab lives in the URL so a particular cut is shareable and the
   back button works, the same convention the boards use for sort and filter. */

export interface Tab {
  /** URL-safe, and stable: it is written into the query string. */
  key: string;
  label: string;
  content: ReactNode;
}

export function Tabs({
  tabs,
  param,
  ariaLabel,
}: {
  tabs: Tab[];
  /** Query-string key, so two tab sets on one page do not collide. */
  param: string;
  ariaLabel: string;
}): ReactElement {
  const first = tabs[0]?.key ?? "";
  const [active, setActive] = useState(first);

  /* Read the URL after mount rather than during render: the page is a static
     export, so the server has no query string and reading one during render
     would make the first paint disagree with the markup. */
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get(param);
    if (requested && tabs.some((t) => t.key === requested)) setActive(requested);
  }, [param, tabs]);

  function choose(key: string): void {
    setActive(key);
    const params = new URLSearchParams(window.location.search);
    if (key === first) params.delete(param);
    else params.set(param, key);
    const query = params.toString();
    window.history.replaceState(null, "", query === "" ? window.location.pathname : `?${query}`);
  }

  return (
    <div className="tabs">
      <div className="tab-strip" role="tablist" aria-label={ariaLabel}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tab-${param}-${t.key}`}
            aria-selected={t.key === active}
            aria-controls={`panel-${param}-${t.key}`}
            className={t.key === active ? "tab tab--on" : "tab"}
            onClick={() => choose(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tabs.map((t) => (
        <div
          key={t.key}
          role="tabpanel"
          id={`panel-${param}-${t.key}`}
          aria-labelledby={`tab-${param}-${t.key}`}
          hidden={t.key !== active}
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
