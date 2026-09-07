import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "../app/page";
import Cohorts from "../app/cohorts/page";
import { h24 } from "../lib/number";
import { fastShareFacts } from "../lib/summary";
import { formatRate } from "../lib/format";

/* The editing pass moved two things: the fast-graduation finding up into the
   fold, and the tax, hour and deployer registers off the sheet onto /cohorts.
   Both moves are structural, so both are asserted against the rendered DOM
   rather than against the page source. */

beforeEach(() => {
  /* the board and the lookup are client components that reach for the API;
     neither is under test here and neither may reach the network */
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Text as a reader reads it: formatDurationLong sets "5 minutes" with a
    non-breaking space, and the fold's sample size hangs together the same way,
    so the assertions compare on ordinary spaces. */
function plain(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\u00a0/g, " ");
}

/** The aria-labels of every register table on the page. */
function registers(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[role="group"][aria-label]')].map(
    (el) => el.getAttribute("aria-label") ?? "",
  );
}

describe("the fast-graduation finding, in the fold", () => {
  it("renders as one sentence beneath the second figure", () => {
    const { container } = render(<Home />);
    const finding = container.querySelector(".finding");
    expect(finding).not.toBeNull();

    const fast = fastShareFacts(h24);
    const text = plain(finding);
    expect(text).toContain(formatRate(fast.underCutoff.rate as number, fast.n));
    expect(text).toContain("of graduations completed inside 5 minutes");
    expect(text).toContain(formatRate(fast.under60.rate as number, fast.n));
    expect(text).toContain("inside 60 seconds");
    // the sample size travels with the sentence: the fold has no heading to carry it
    expect(text).toContain(`n = ${fast.n.toLocaleString("en-US")} graduations`);
  });

  it("stands inside the crop — above the colophon strip", () => {
    const { container } = render(<Home />);
    const nodes = [...container.querySelectorAll(".finding, .colophon")];
    expect(nodes[0]?.className).toContain("finding");
  });

  it("carries both shares through Stat, with n, window and measurement", () => {
    const { container } = render(<Home />);
    const fast = fastShareFacts(h24);
    for (const name of ["fast-under-cutoff", "fast-under-60"]) {
      const el = container.querySelector(`[data-stat="${name}"]`) as HTMLElement | null;
      expect(el, name).not.toBeNull();
      expect(el?.dataset.n).toBe(String(fast.n));
      expect(el?.dataset.window).toBe("24h");
    }
  });

  it("has no separate Fast graduations entry left on the sheet", () => {
    const { container } = render(<Home />);
    expect(container.querySelector("#h-fast")).toBeNull();
  });
});

describe("the registers that moved to /cohorts", () => {
  it("leaves the tax, hour and deployer tables off the sheet", () => {
    const { container } = render(<Home />);
    const labels = registers(container).join(" | ");
    expect(labels).not.toMatch(/creator tax/i);
    expect(labels).not.toMatch(/by hour/i);
    expect(labels).not.toMatch(/launches per deployer/i);
  });

  it("keeps the pair register on the sheet, beneath the pair finding", () => {
    const { container } = render(<Home />);
    expect(registers(container).join(" | ")).toMatch(/by pair token/i);
    const entry = container.querySelector("#h-pair")?.closest(".entry");
    expect(plain(entry)).toContain("the pair token makes no difference");
  });

  it("finds all three on /cohorts", () => {
    const { container } = render(<Cohorts />);
    const labels = registers(container).join(" | ");
    expect(labels).toMatch(/creator tax/i);
    expect(labels).toMatch(/by hour of day/i);
    expect(labels).toMatch(/launches per deployer/i);
  });

  it("gives the fast-graduation number a home on /cohorts too", () => {
    const { container } = render(<Cohorts />);
    const text = plain(container);
    expect(container.querySelector('[id^="h-fast-"]')).not.toBeNull();
    expect(text).toContain("of graduations completed inside 5 minutes");
    expect(text).toContain("inside 60 seconds");
  });

  it("points at the cohorts page from the sheet, once", () => {
    const { container } = render(<Home />);
    const entry = container.querySelector("#h-cohorts")?.closest(".entry");
    expect(plain(entry)).toContain("Creator tax, hour of day, day of week");
    expect(entry?.querySelector('a[href="/cohorts"]')).not.toBeNull();
  });
});
