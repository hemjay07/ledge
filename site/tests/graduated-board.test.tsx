import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { GraduatedBoard } from "../components/Graduated";
import { formatDuration, formatUtcLong } from "../lib/format";
import type { GraduatedFile } from "../lib/graduated-schema";

/* A frozen, hand-built fixture, not public/graduated.json. Every expectation
   below is derived from this fixture through the same formatters the
   component renders with, so the fixture can be edited freely without the
   assertions drifting into hardcoded strings. */
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

afterEach(() => cleanup());

describe("GraduatedBoard", () => {
  it("sorts fastest first by default, with duration shown on every row (CONSTRAINTS 1)", () => {
    const { container } = render(<GraduatedBoard data={FIXTURE} />);
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows.map((r) => r.querySelector("th")?.textContent)).toEqual([
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xcccccccccccccccccccccccccccccccccccccccc",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ]);
    for (const row of FIXTURE.rows) {
      expect(container.textContent).toContain(formatDuration(row.durationSeconds));
    }
  });

  it("links every row to /t/{address}", () => {
    const { container } = render(<GraduatedBoard data={FIXTURE} />);
    for (const row of FIXTURE.rows) {
      const link = container.querySelector(`a[href="/t/${row.token}"]`);
      expect(link).not.toBeNull();
      expect(link?.textContent).toBe(row.token);
    }
  });

  it("prints the graduated timestamp and the pair/tax facts a row carries, or says they were not read", () => {
    const { container } = render(<GraduatedBoard data={FIXTURE} />);
    const text = container.textContent ?? "";
    expect(text).toContain(formatUtcLong(FIXTURE.rows[1]!.graduatedAt)); // token A
    expect(text).toContain("100 bps");
    expect(text).toContain("not read"); // token C: pairClass and creatorTaxBps null
  });

  it("re-sorts to slowest-first on request, without losing the duration column", () => {
    const { container } = render(<GraduatedBoard data={FIXTURE} />);
    const slowestLink = [...container.querySelectorAll(".sheet-nav a")].find(
      (a) => a.textContent === "Slowest first",
    );
    expect(slowestLink).toBeTruthy();
    fireEvent.click(slowestLink!);
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows.map((r) => r.querySelector("th")?.textContent)).toEqual([
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "0xcccccccccccccccccccccccccccccccccccccccc",
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ]);
  });

  it("never renders a score, grade, or verdict word", () => {
    const { container } = render(<GraduatedBoard data={FIXTURE} />);
    const text = (container.textContent ?? "").toLowerCase();
    for (const banned of ["rug", "score", "grade", "rigged", "organic", "safe", "risky"]) {
      expect(text).not.toContain(banned);
    }
  });

  it("renders a plain note, not a table, when there are no rows", () => {
    const { container } = render(<GraduatedBoard data={{ ...FIXTURE, rows: [] }} />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(container.textContent).toContain("No graduation joins to a launch on record yet.");
  });
});
