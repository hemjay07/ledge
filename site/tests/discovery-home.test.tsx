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
describe("the front door, above the fold", () => {
  /* The home page stopped reprinting the Number's whole fold on 2026-09-10:
     it was identical to /number, doubled the page's length, and put the most
     discouraging true figure on the site in front of a first-time reader. The
     rate is still stated here, with its window and denominator, and linked to
     in full -- asserted below and in sample.test.tsx. Which true thing leads is
     a choice; hiding one is not, and nothing is hidden. */
  it("opens with the live pulse, ahead of the stated rate", async () => {
    const { container } = render(<Home />);
    await waitFor(() => expect(container.querySelector(".live-pulse")).not.toBeNull());
    const lead = container.querySelector(".discovery-lead");
    const rate = container.querySelector(".headline-rate");
    expect(lead).not.toBeNull();
    expect(lead?.querySelector(".live-pulse")).not.toBeNull();
    expect(rate).not.toBeNull();
    expect(lead!.compareDocumentPosition(rate!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("orders capability, shape and paths between the pulse and the Number", async () => {
    const { container } = render(<Home />);
    await waitFor(() => expect(container.querySelector(".live-pulse")).not.toBeNull());
    const order = [".live-pulse", ".capability", ".shape-lead", ".paths-on", ".headline-rate"].map(
      (sel) => container.querySelector(sel),
    );
    expect(order.every((el) => el !== null)).toBe(true);
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("carries no verdict about an individual token in the capability line or its facts", () => {
    const { container } = render(<Home />);
    const text = (container.querySelector(".capability")?.textContent ?? "").toLowerCase();
    for (const banned of ["score", "rug", "safe", "risk", "likely", "predict", "odds", "chance"]) {
      expect(text.includes(banned), `"${banned}" is in the capability copy`).toBe(false);
    }
  });

  it("states the capability's fact with its denominator, derived from the frozen fixture", () => {
    const { container } = render(<Home />);
    const fact = underSecondsFact(allTime, 10);
    const stat = container.querySelector('[data-stat="under-ten-seconds"]');
    expect(stat).not.toBeNull();
    expect(stat?.getAttribute("data-n")).toBe(String(fact.n));
    expect(stat?.getAttribute("data-window")).toBe("all-time");
    expect(container.querySelector(".capability")?.textContent).toContain(
      formatCount(allTime.graduations),
    );
  });

  it("draws the shape of the whole record, fed from allTime.ttg, ahead of the paths", () => {
    const { container } = render(<Home />);
    const shape = container.querySelector(".shape-lead .shape");
    expect(shape).not.toBeNull();
    expect(shape?.querySelectorAll("rect.shape-bar").length).toBe(allTime.ttg.histogram.length);
  });

  it("carries three paths onward: the live board, every graduation, the graveyard", () => {
    const { container } = render(<Home />);
    const paths = container.querySelector(".paths-on");
    expect(paths).not.toBeNull();
    const hrefs = [...(paths?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/live", "/graduated", "/graveyard"]);
  });

  /* CONSTRAINTS 5 is a guarantee about reachability, not about which page
     leads. Everything the sheet used to reprint is one click away and named,
     so nothing can be quietly dropped without this failing. */
  it("leaves nothing stranded: every figure it stopped reprinting is named and linked", () => {
    const { container } = render(<Home />);
    const rate = container.querySelector(".headline-rate");
    expect(rate).not.toBeNull();
    expect(rate?.textContent).toMatch(/launches in the last 24 hours/);
    for (const href of ["/number", "/method", "/cohorts", "/live", "/graduated", "/graveyard"]) {
      expect(container.querySelector(`a[href="${href}"]`), href).not.toBeNull();
    }
  });

  it("carries no folio numbers", () => {
    const { container } = render(<Home />);
    expect(container.querySelectorAll(".entry[data-folio]").length).toBe(0);
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
