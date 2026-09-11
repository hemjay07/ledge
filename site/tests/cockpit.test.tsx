import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Cockpit from "../app/cockpit/page";
import Home from "../app/page";
import Cohorts from "../app/cohorts/page";
import { ConfigGrid, type GridWindow } from "../components/ConfigGrid";
import { allTime, h24, numberFile } from "../lib/number";
import { sameMeasurement } from "../lib/windows";
import { PAIR_ORDER, TAX_ORDER, pairTaxOrder } from "../lib/rows";

/* /cockpit is a lookup of a historical base rate, not a recommender. Every
   assertion below is about that difference: the whole population is printed,
   the selects mark rather than sort or filter, a cell the sample cannot
   support prints its sample size, and no sentence on the page tells a reader
   what to launch. */

beforeEach(() => {
  /* / carries the board and the lookup, both client components that reach for
     the API. Neither is under test here and neither may reach the network. */
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function tables(container: HTMLElement): HTMLTableElement[] {
  return [...container.querySelectorAll('[role="group"][aria-label] table')] as HTMLTableElement[];
}

function bodyRows(table: HTMLTableElement): HTMLTableRowElement[] {
  return [...table.querySelectorAll<HTMLTableRowElement>("tbody tr")];
}

/** The row keys of a table, in printed order: pair token and creator tax. */
function order(table: HTMLTableElement): string[] {
  return bodyRows(table).map((tr) => {
    const cells = [...tr.children];
    return `${cells[0]?.textContent ?? ""}/${cells[1]?.textContent ?? ""}`;
  });
}

function plain(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\u00a0/g, " ");
}

const WINDOWS_RENDERED = sameMeasurement(h24, allTime) ? 1 : 2;

  /* The per-page navigation moved into the shell (app/layout.tsx) on
     2026-09-11, so a page no longer carries its own copy and these assertions
     no longer belong here. The guarantee they protected -- that every
     published surface stays reachable, which is what CONSTRAINTS 5 rests on --
     was not dropped: it is asserted once against the shell itself in
     tests/topbar.test.tsx, which is stricter, because a destination now has to
     be reachable from EVERY page rather than from whichever pages happened to
     have a test. */
describe("the grid", () => {
  it("prints all 20 pair x tax cells, in every window rendered", () => {
    const { container } = render(<Cockpit />);
    const grids = tables(container);
    expect(grids.length).toBe(WINDOWS_RENDERED);
    for (const table of grids) {
      expect(bodyRows(table).length).toBe(20);
      expect(allTime.cohorts.pairTax.length).toBe(20);
    }
  });

  it("is ordered pair-major then tax ascending, never by rate", () => {
    const { container } = render(<Cockpit />);
    const expected = pairTaxOrder(allTime.cohorts.pairTax).map((r) => r.bucket);
    // the fixed order is the source's own, not the measurement's
    expect(expected[0]).toBe(`${PAIR_ORDER[0]}/${TAX_ORDER[0]}`);
    const printed = order(tables(container)[0] as HTMLTableElement);
    expect(printed.length).toBe(20);

    const rates = pairTaxOrder(allTime.cohorts.pairTax).map((r) => r.rate ?? -1);
    const sortedByRate = [...rates].sort((a, b) => b - a);
    expect(rates).not.toEqual(sortedByRate);
  });

  it("carries a sample-size column beside both rates, and an All footing", () => {
    const { container } = render(<Cockpit />);
    const table = tables(container)[0] as HTMLTableElement;
    const heads = [...table.querySelectorAll("thead th")].map((th) => plain(th));
    expect(heads).toContain("Launches (n)");
    expect(heads).toContain("Rate");
    expect(heads).toContain("Excluding fast");
    expect(plain(table.querySelector("tfoot th"))).toBe("All");
  });

  it("puts every rate through Stat, with its n, window and measurement", () => {
    const { container } = render(<Cockpit />);
    const row = pairTaxOrder(allTime.cohorts.pairTax)[0];
    const el = container.querySelector(
      `[data-stat="pairtax-rate-all-${row?.bucket}"]`,
    ) as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el?.dataset.n).toBe(String(row?.launches));
    expect(el?.dataset.window).toBe("all-time");
  });
});

describe("a cell the sample cannot support", () => {
  /* The rule under test is a RENDERING rule: a cell the sample cannot support
     prints its sample size instead of a percentage. It was asserted over
     whichever live rows happened to be insufficient, plus a guard that at
     least one existed. That guard turned the rule into a hostage of the
     crawl: every pairTax cohort has now passed n = 30, the guard failed, and
     the suite went red without anything being wrong. Data moving is not a
     regression, and this suite has been broken by live figures before.

     So the rule is now proved against a FROZEN row that is insufficient by
     construction, which cannot stop being insufficient. The loop over live
     rows is kept underneath it: while any real cell is under n = 30 it is
     still checked, and when none are, the frozen case still proves the rule.
     Strictly more coverage than before, and none of it drifts. */
  it("prints its sample size and no percentage, on a row that cannot support one", () => {
    const under30 = {
      bucket: "eth/4-5%",
      pairClass: "eth",
      taxBucket: "4–5%",
      launches: 12,
      graduations: 0,
      rate: null,
      insufficient: true,
      excludingFast: {
        cutoffSeconds: 300,
        graduations: 0,
        rate: null,
        oneIn: null,
        insufficient: true,
      },
    };
    const frozen: GridWindow = {
      key: "all",
      label: "all-time",
      folio: "04",
      heading: "All-time",
      headingNote: "· all-time · n = 12 launches",
      caption: "A frozen cell under n = 30.",
      ariaLabel: "A frozen cell under n = 30",
      note: null,
      rows: [under30],
      total: {
        launches: 12,
        graduations: 0,
        rate: null,
        insufficient: true,
        excludingFast: { graduations: 0, rate: null, oneIn: null, insufficient: true },
      },
    };
    const frozenRender = render(
      <ConfigGrid folio="04" windows={[frozen]} crawledAt={numberFile.crawledAt} />,
    );
    const cell = frozenRender.container.querySelector(
      '[data-stat="pairtax-rate-all-eth/4-5%"]',
    ) as HTMLElement | null;
    expect(cell).not.toBeNull();
    expect(plain(cell)).toBe("not enough data (n=12)");
    expect(plain(cell)).not.toContain("%");
    expect(cell?.dataset.insufficient).toBe("true");
    cleanup();

    const { container } = render(<Cockpit />);
    const insufficient = allTime.cohorts.pairTax.filter((r) => r.insufficient);

    for (const row of insufficient) {
      const el = container.querySelector(
        `[data-stat="pairtax-rate-all-${row.bucket}"]`,
      ) as HTMLElement | null;
      expect(el, row.bucket).not.toBeNull();
      expect(plain(el)).toBe(`not enough data (n=${row.launches})`);
      expect(plain(el)).not.toContain("%");
      expect(el?.dataset.insufficient).toBe("true");
    }
  });

  it("prints the excluding-fast rate of the same cell the same way", () => {
    const { container } = render(<Cockpit />);
    for (const row of allTime.cohorts.pairTax.filter((r) => r.excludingFast.insufficient)) {
      const el = container.querySelector(
        `[data-stat="pairtax-excluding-fast-all-${row.bucket}"]`,
      ) as HTMLElement | null;
      expect(plain(el), row.bucket).toBe(`not enough data (n=${row.launches})`);
      expect(plain(el)).not.toContain("%");
    }
  });
});

describe("the two selects", () => {
  it("start with nothing selected, and mark nothing", () => {
    const { container } = render(<Cockpit />);
    expect(container.querySelectorAll('tbody tr[data-picked="true"]').length).toBe(0);
    for (const select of [...container.querySelectorAll("select")]) {
      expect((select as HTMLSelectElement).value).toBe("");
    }
  });

  it("mark exactly one row in each table, and change no ordering", () => {
    const { container } = render(<Cockpit />);
    const before = tables(container).map((t) => order(t));
    const rowCountBefore = container.querySelectorAll("tbody tr").length;

    const [pair, tax] = [...container.querySelectorAll("select")] as HTMLSelectElement[];
    fireEvent.change(pair as HTMLSelectElement, { target: { value: "eth" } });
    // one control alone names five rows, so it names none: nothing is marked yet
    expect(container.querySelectorAll('tbody tr[data-picked="true"]').length).toBe(0);
    fireEvent.change(tax as HTMLSelectElement, { target: { value: "1%" } });

    for (const table of tables(container)) {
      expect(bodyRows(table).filter((tr) => tr.dataset.picked === "true").length).toBe(1);
    }
    expect(container.querySelectorAll('tbody tr[data-picked="true"]').length).toBe(
      WINDOWS_RENDERED,
    );

    // nothing sorted, nothing filtered, nothing removed
    expect(tables(container).map((t) => order(t))).toEqual(before);
    expect(container.querySelectorAll("tbody tr").length).toBe(rowCountBefore);

    const marked = container.querySelector('tbody tr[data-picked="true"]') as HTMLTableRowElement;
    /* the row head carries the separator that joins it to the creator tax on
       a narrow sheet, so the assertion is on what the head names */
    expect(plain(marked.children[0])).toContain("ETH");
    expect(plain(marked.children[1])).toBe("1%");
  });
});

describe("the narrow sheet", () => {
  /* Six columns do not fit a 390px measure, and the answer must not be behind
     a horizontal scroll a reader has to discover. The row reflows to two
     lines instead, which is a layout change and not a content one: every
     figure is in the markup at every width, and these assertions are on the
     markup, never on the CSS. */
  it("keeps every row's excluding-fast rate and its n, with the units the hidden column heads carried", () => {
    const { container } = render(<Cockpit />);
    for (const table of tables(container)) {
      const rows = bodyRows(table);
      expect(rows.length).toBe(20);
      for (const tr of rows) {
        const cells = [...tr.children];
        const text = plain(tr);

        // line one: the configuration, the launch count with its "n =", and
        // the rate excluding graduations inside the cutoff
        expect(plain(cells[0])).toContain("·");
        expect(plain(cells[2])).toMatch(/^n = [\d,]+$/);
        const excludingFast = tr.querySelector('[data-stat*="excluding-fast"]');
        const zeroGraduations = /0 of [\d,]+/.test(plain(cells[5]));
        expect(excludingFast !== null || zeroGraduations, plain(cells[0])).toBe(true);

        // line two: the rate over every graduation, and the graduation count
        expect(text).toContain("all graduations");
        expect(plain(cells[3])).toMatch(/^[\d,]+ graduated$/);
      }
    }
  });

  it("keeps the n beside the rate it belongs to, in the cell order the reflow uses", () => {
    const { container } = render(<Cockpit />);
    const row = pairTaxOrder(allTime.cohorts.pairTax)[0];
    const tr = container.querySelector(
      `[data-stat="pairtax-rate-all-${row?.bucket}"]`,
    )?.closest("tr") as HTMLTableRowElement;
    const cells = [...tr.children].map((c) => plain(c));
    expect(cells[2]).toBe(`n = ${row?.launches.toLocaleString("en-US")}`);
    expect(cells[3]).toBe(`${row?.graduations.toLocaleString("en-US")} graduated`);
    expect(cells[4]).toContain("all graduations");
  });
});

/* The framing is the build: this page looks up a base rate over a population
   that has already launched. A word from this list on the page would turn the
   table into advice about a launch that has not happened. */
const BANNED = [
  "recommend",
  "recommended",
  "best",
  "optimal",
  "optimise",
  "optimize",
  "winning",
  "should",
  "you can",
  "pick the",
  "choose",
  "avoid",
  "prefer",
  "advice",
  "advise",
  "predict",
  "likely",
  "odds",
  "chance",
  "expect",
  "guarantee",
  "improve",
  "maximise",
  "maximize",
  "boost",
  "safest",
  "worst",
  "top-performing",
  "trade smarter",
  "data-driven",
  "alpha",
  "premium",
  "waitlist",
  "connect wallet",
];

describe("the copy", () => {
  it("carries no prescription", () => {
    const { container } = render(<Cockpit />);
    const text = plain(container).toLowerCase();
    for (const word of BANNED) {
      expect(text, `"${word}" is on /cockpit`).not.toContain(word);
    }
    for (const word of ["win", "rank", "ranked", "score"]) {
      expect(new RegExp(`\\b${word}\\b`).test(text), `"${word}" is on /cockpit`).toBe(false);
    }
  });

  it("says what a configuration is, what the second rate excludes, and what the counts describe", () => {
    const { container } = render(<Cockpit />);
    const entry = plain(container.querySelector("#h-what")?.parentElement);
    expect(entry).toContain("A configuration is the pair token");
    expect(entry).toContain("excludes graduations that completed inside 5 minutes");
    expect(entry).toContain("not any launch not yet made");
    // ≤ 70 words, in the register's plain voice
    const words = entry.replace("What these are", "").trim().split(/\s+/).filter(Boolean);
    expect(words.length).toBeLessThanOrEqual(70);
  });
});

