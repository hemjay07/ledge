import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { GraduatedBoard } from "../components/Graduated";
import { formatDuration } from "../lib/format";
import type { GraduatedFile } from "../lib/graduated-schema";

/* A frozen, hand-built fixture, not public/graduated.json. Every expectation
   below is derived from this fixture through the same formatters the
   component renders with, so the fixture can be edited freely without the
   assertions drifting into hardcoded strings.

   2026-09-12 (REVAMP.md "the amendment", boards rebuilt page by page): the
   board's own controls became a `<select>` + filter disclosure, the same
   vocabulary /live's own board uses, replacing the row of plain sort links;
   the default sort became most-recently-graduated, because a visitor here
   wants to know what just happened, with fastest-first kept one click away.
   Assertions describing the old `.sheet-nav` links and the old fastest-first
   default are rewritten below rather than carried forward. */
const FIXTURE: GraduatedFile = {
  generatedAt: "2026-09-10T12:00:00.000Z",
  staleAfterSeconds: 7200,
  totalGraduationRows: 4,
  excludedNoLaunch: 1,
  excludedUnmatched: 0,
  rows: [
    {
      token: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      durationSeconds: 900,
      graduatedAt: "2026-09-10T11:15:00.000Z",
      launchedAt: "2026-09-10T11:00:00.000Z",
      pairClass: "stable",
      creatorTaxBps: 200,
    },
    {
      token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      durationSeconds: 8,
      graduatedAt: "2026-09-10T11:00:08.000Z",
      launchedAt: "2026-09-10T11:00:00.000Z",
      pairClass: "eth",
      creatorTaxBps: 100,
    },
    {
      token: "0xcccccccccccccccccccccccccccccccccccccccc",
      durationSeconds: 300,
      graduatedAt: "2026-09-10T11:05:00.000Z",
      launchedAt: "2026-09-10T11:00:00.000Z",
      pairClass: null,
      creatorTaxBps: null,
    },
  ],
};

const BOARD_PROPS = {
  generatedAt: FIXTURE.generatedAt,
  staleAfterSeconds: FIXTURE.staleAfterSeconds,
  totalGraduationRows: FIXTURE.totalGraduationRows,
  excludedNoLaunch: FIXTURE.excludedNoLaunch,
  excludedUnmatched: FIXTURE.excludedUnmatched,
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

/* The list shortens an address the way worker/src/text.ts does, so the same
   token reads the same here and on its own page. The FULL address stays the
   link target, which is the part that must not regress: a shortened href
   would be a broken link, where shortened text is just a narrower column. */
const short = (a: string) => `${a.slice(0, 10)}…${a.slice(-6)}`;

describe("GraduatedBoard", () => {
  it("sorts most-recently-graduated first by default, with duration shown on every row (CONSTRAINTS 1)", () => {
    const { container } = render(
      <GraduatedBoard initialRows={FIXTURE.rows} totalCount={FIXTURE.rows.length} {...BOARD_PROPS} />,
    );
    const rows = [...container.querySelectorAll(".graduated-table-wrap tbody tr")];
    // most recently graduated: B (11:15) then C (11:05) then A (11:00:08)
    expect(rows.map((r) => r.querySelector("th")?.textContent)).toEqual([
      short("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
      short("0xcccccccccccccccccccccccccccccccccccccccc"),
      short("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ]);
    for (const row of FIXTURE.rows) {
      expect(container.textContent).toContain(formatDuration(row.durationSeconds));
    }
  });

  it("links every row to /t/{address}", () => {
    const { container } = render(
      <GraduatedBoard initialRows={FIXTURE.rows} totalCount={FIXTURE.rows.length} {...BOARD_PROPS} />,
    );
    for (const row of FIXTURE.rows) {
      const link = container.querySelector(`a[href="/t/${row.token}"]`);
      expect(link).not.toBeNull();
      // shortened in the cell, whole in the href and the title
      expect(link?.textContent?.trim()).toBe(short(row.token));
      expect(link?.getAttribute("title")).toBe(row.token);
    }
  });

  it("prints the pair/tax facts a row carries, or says they were not read", () => {
    const { container } = render(
      <GraduatedBoard initialRows={FIXTURE.rows} totalCount={FIXTURE.rows.length} {...BOARD_PROPS} />,
    );
    const text = container.textContent ?? "";
    // the reader's own unit: every other page says "1%", not "100 bps"
    expect(text).toContain("1%");
    expect(text).not.toContain("100 bps");
    expect(text).toContain("not read"); // token C: pairClass and creatorTaxBps null
  });

  it("names the ranked column for every sort key, with most-recently-graduated the default", () => {
    const { container } = render(
      <GraduatedBoard initialRows={FIXTURE.rows} totalCount={FIXTURE.rows.length} {...BOARD_PROPS} />,
    );
    const select = screen.getByLabelText("Sort") as HTMLSelectElement;
    const options = [...select.querySelectorAll("option")].map((el) => el.textContent);
    expect(options).toEqual(["Fastest first", "Slowest first", "Most recently graduated", "Pair token", "Creator tax"]);
    expect(select.value).toBe("graduatedAt");
    expect(container.querySelectorAll(".graduated-table-wrap tbody tr").length).toBe(3);
  });

  it("re-sorts to fastest-first on request, without losing the duration column", () => {
    const { container } = render(
      <GraduatedBoard initialRows={FIXTURE.rows} totalCount={FIXTURE.rows.length} {...BOARD_PROPS} />,
    );
    const select = screen.getByLabelText("Sort") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "duration" } });
    const rows = [...container.querySelectorAll(".graduated-table-wrap tbody tr")];
    expect(rows.map((r) => r.querySelector("th")?.textContent)).toEqual([
      short("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      short("0xcccccccccccccccccccccccccccccccccccccccc"),
      short("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
    ]);
  });

  it("filters by the printed time-to-graduate column via 'Graduated in', without a verdict word in any option", () => {
    render(<GraduatedBoard initialRows={FIXTURE.rows} totalCount={FIXTURE.rows.length} {...BOARD_PROPS} />);
    const select = screen.getByLabelText("Graduated in") as HTMLSelectElement;
    const labels = [...select.querySelectorAll("option")].map((el) => (el.textContent ?? "").toLowerCase());
    for (const banned of ["instant", "organic", "bot"]) {
      expect(labels.some((l) => l.includes(banned))).toBe(false);
    }
    fireEvent.change(select, { target: { value: "u10" } });
    expect(window.location.search).toContain("gradIn=u10");
  });

  it("never renders a score, grade, or verdict word", () => {
    const { container } = render(
      <GraduatedBoard initialRows={FIXTURE.rows} totalCount={FIXTURE.rows.length} {...BOARD_PROPS} />,
    );
    const text = (container.textContent ?? "").toLowerCase();
    for (const banned of ["rug", "score", "grade", "rigged", "organic", "safe", "risky"]) {
      expect(text).not.toContain(banned);
    }
  });

  it("renders a plain note, not a table, when there are no rows", () => {
    const { container } = render(<GraduatedBoard initialRows={[]} totalCount={0} {...BOARD_PROPS} />);
    expect(container.querySelectorAll(".graduated-table-wrap tbody tr")).toHaveLength(0);
    expect(container.textContent).toContain("No graduation joins to a launch on record yet.");
  });
});
