import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import Home from "../app/page";
import { LivePulse } from "../components/Live";
import { allTime } from "../lib/number";
import { formatCount } from "../lib/format";
import { underSecondsFact } from "../lib/summary";
import live from "./api-fixtures/live-ok.json";

/* The front-door rebuild (2026-09): "/" leads with a live pulse that moves,
   one plain line naming what LEDGE lets a reader do, the shape of the whole
   record as proof, and three paths onward -- all ahead of the Pons Number's
   own fold, which keeps exactly the shape it has on /number. Every assertion
   about the Number's own figures, or the capability line's own fact, is
   derived from the frozen fixture (tests/fixtures.ts) or from the same
   formatter the page uses, never a hand-typed rate. */

function answerWith(payload: unknown) {
  const impl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
  vi.stubGlobal("fetch", impl);
  return impl;
}

beforeEach(() => {
  answerWith(live);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

  /* The per-page navigation moved into the shell (app/layout.tsx) on
     2026-09-11, so a page no longer carries its own copy and these assertions
     no longer belong here. The guarantee they protected -- that every
     published surface stays reachable, which is what CONSTRAINTS 5 rests on --
     was not dropped: it is asserted once against the shell itself in
     tests/topbar.test.tsx, which is stricter, because a destination now has to
     be reachable from EVERY page rather than from whichever pages happened to
     have a test. */
/* 2026-09-12: this describe block asserted the 2026-09 front door's own order
   -- pulse, capability line, shape, paths, then the Number's fold. REVAMP.md's
   dated entry "the homepage direction" replaced that layout outright with the
   one decided across the three mockups (design/homepage-{instrument,terminal,
   editorial}.html): the LIVE card, the hook, the four-row table, the callout,
   the FINDING card, the NOW card, three doors, a reserved slot, and a "where
   the rest is" line. Every assertion below is rewritten to that order and
   those class names; none of them loosens a CONSTRAINTS guard -- the same
   things (no verdict, the Stat denominator, the shape fed from allTime.ttg,
   every dropped surface still linked) are checked against the new markup. */
describe("the front door, above the fold", () => {
  it("opens with the LIVE card, ahead of the hook", async () => {
    const { container } = render(<Home />);
    await waitFor(() => expect(container.querySelector(".home-live")).not.toBeNull());
    const live = container.querySelector(".home-live");
    const hook = container.querySelector(".home-hook");
    expect(live).not.toBeNull();
    expect(hook).not.toBeNull();
    expect(live!.compareDocumentPosition(hook!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("orders the hook, the table, the callout, the finding, the NOW card and the doors", async () => {
    const { container } = render(<Home />);
    await waitFor(() => expect(container.querySelector(".home-live")).not.toBeNull());
    const order = [
      ".home-live",
      ".home-hook",
      ".home-table",
      ".home-callout",
      ".home-finding",
      ".home-now",
      ".home-door-1",
    ].map((sel) => container.querySelector(sel));
    expect(order.every((el) => el !== null)).toBe(true);
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("carries no verdict about an individual token in the hook or the doors", () => {
    const { container } = render(<Home />);
    const text = (
      (container.querySelector(".home-hook")?.textContent ?? "") +
      (container.querySelector(".home-door-1")?.textContent ?? "") +
      (container.querySelector(".home-door-2")?.textContent ?? "") +
      (container.querySelector(".home-door-3")?.textContent ?? "")
    ).toLowerCase();
    for (const banned of ["score", "rug", "safe", "risk", "likely", "predict", "odds", "chance"]) {
      expect(text.includes(banned), `"${banned}" is in the hook or door copy`).toBe(false);
    }
  });

  it("states the hook's fact with its denominator, derived from the frozen fixture", () => {
    const { container } = render(<Home />);
    const fact = underSecondsFact(allTime, 10);
    const stat = container.querySelector('[data-stat="under-ten-seconds"]');
    expect(stat).not.toBeNull();
    expect(stat?.getAttribute("data-n")).toBe(String(fact.n));
    expect(stat?.getAttribute("data-window")).toBe("all-time");
    expect(container.querySelector(".home-hook")?.textContent).toContain(
      formatCount(allTime.graduations),
    );
  });

  it("draws the shape of the whole record, fed from allTime.ttg, in the FINDING card", () => {
    const { container } = render(<Home />);
    const shape = container.querySelector(".home-finding .shape");
    expect(shape).not.toBeNull();
    expect(shape?.querySelectorAll("rect.shape-bar").length).toBe(allTime.ttg.histogram.length);
  });

  it("carries three paths onward: the live board, every graduation, the graveyard", () => {
    const { container } = render(<Home />);
    const hrefs = [".home-door-1", ".home-door-2", ".home-door-3"].map(
      (sel) => container.querySelector(sel)?.getAttribute("href"),
    );
    expect(hrefs).toEqual(["/live", "/graduated", "/graveyard"]);
  });

  /* CONSTRAINTS 5 is a guarantee about reachability, not about which page
     leads. Everything the sheet used to reprint is one click away and named,
     so nothing can be quietly dropped without this failing. */
  it("leaves nothing stranded: every figure it stopped reprinting is named and linked", () => {
    const { container } = render(<Home />);
    const rest = container.querySelector(".home-rest");
    expect(rest).not.toBeNull();
    for (const href of ["/number", "/method", "/cohorts", "/cockpit", "/live", "/graduated", "/graveyard"]) {
      expect(container.querySelector(`a[href="${href}"]`), href).not.toBeNull();
    }
  });

  it("carries no folio numbers", () => {
    const { container } = render(<Home />);
    expect(container.querySelectorAll(".entry[data-folio]").length).toBe(0);
  });

  /* Added 2026-09-12: the reserved slot for LEDGE's own launch renders no
     text -- only the comment REVAMP.md's dated entry names. */
  it("renders the reserved slot for LEDGE's own launch as nothing", () => {
    const { container } = render(<Home />);
    expect(container.textContent ?? "").not.toMatch(/pre-registration/i);
  });
});

describe("the live pulse", () => {
  it("reads two counts off the same rows the board fetches, each with a window", async () => {
    const { container } = render(<LivePulse />);
    await waitFor(() => expect(container.querySelectorAll(".pulse-reading").length).toBe(2));
    const takingBuys = live.rows.filter((r) => r.buys > 0).length;
    const lastHour = live.rows.filter((r) => r.ageSeconds <= 3600).length;
    const readings = [...container.querySelectorAll(".pulse-figure")].map((el) => el.textContent);
    expect(readings).toEqual([formatCount(takingBuys), formatCount(lastHour)]);
    expect(container.textContent).toContain("taking buys right now");
    expect(container.textContent).toContain("launched in the last hour");
  });

  it("carries the live board's own population as the first reading's denominator", async () => {
    const { container } = render(<LivePulse />);
    await waitFor(() => expect(container.querySelector(".pulse-reading")).not.toBeNull());
    expect(container.textContent).toContain(`of ${formatCount(live.count)}`);
  });

  /* The guarantee under test is that an unreachable live layer is SAID, never
     filled in with a stale reading dressed as a live one. The exact wording
     changed on 2026-09-10 because the old copy came from the token lookup and
     opened "The lookup did not answer" -- the wrong noun, and a failure as the
     first sentence a visitor reads. The assertion is now on the behaviour
     rather than on the sentence: no figure is shown, and the absence is
     stated. */
  it("states the absence rather than showing a stale pulse as though it were live", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const { container } = render(<LivePulse />);
    await waitFor(() => expect(container.querySelector(".pulse-quiet")).not.toBeNull());
    expect(container.querySelectorAll(".pulse-figure").length).toBe(0);
    expect(container.textContent).toMatch(/not reachable/i);
    expect(container.textContent).toMatch(/unaffected/i);
  });
});

/* Added 2026-09-12 (REVAMP.md "the homepage direction"): the four guarantees
   the build brief calls out by name, on top of the structural rewrite above. */
describe("the table, the NOW card and the LIVE card's stale state", () => {
  it("carries share and count on every one of the table's four rows", () => {
    const { container } = render(<Home />);
    const rows = container.querySelectorAll(".home-table tbody tr");
    // four threshold rows plus the median row
    expect(rows.length).toBe(5);
    for (const row of Array.from(rows).slice(0, 4)) {
      const share = row.querySelector("td.fig [data-stat]");
      const count = row.querySelector("td.fig.n");
      expect(share, row.textContent ?? "").not.toBeNull();
      expect(count, row.textContent ?? "").not.toBeNull();
      expect(count?.textContent).toMatch(/\d/);
    }
  });

  it("shows at most 5 rows on the NOW card and links to /live with the live board's count", async () => {
    const manyRows = Array.from({ length: 9 }, (_, i) => ({
      ...live.rows[0],
      token: `0x${(i + 1).toString().padStart(40, "0")}`,
      buys: 9 - i,
    }));
    const manyLive = { ...live, count: manyRows.length, rows: manyRows };
    answerWith(manyLive);
    const { container } = render(<Home />);
    await waitFor(() => expect(container.querySelector(".home-now table")).not.toBeNull());
    const bodyRows = container.querySelectorAll(".home-now tbody tr");
    expect(bodyRows.length).toBe(5);
    const link = container.querySelector('.home-now a[href="/live"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain(formatCount(manyRows.length));
  });

  it("renders the reserved slot for LEDGE's own launch as nothing", () => {
    const { container } = render(<Home />);
    // the slot is a JSX comment only -- nothing it could render is on the page
    expect(container.textContent ?? "").not.toMatch(/pre-registration/i);
  });

  it("takes is-stale on the LIVE card's header when the fixture says the live index is stale", async () => {
    const staleLive = { ...live, live: { ...live.live, stale: true } };
    answerWith(staleLive);
    const { container } = render(<Home />);
    await waitFor(() => expect(container.querySelector(".home-live")).not.toBeNull());
    await waitFor(() => expect(container.querySelector(".home-live.is-stale-card")).not.toBeNull());
    expect(container.querySelector(".home-live .card-header .is-stale")).not.toBeNull();
  });
});
