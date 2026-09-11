import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { GraduatedBoard } from "../components/Graduated";
import { PAGE_SIZE } from "../lib/paginate";
import type { GraduatedFile, GraduatedRow } from "../lib/graduated-schema";

/* Only the first page renders at build time (REVAMP.md pagination) -- the
   defect this fixes is 2,500+ rows and 1.3 MB of HTML in one document. This
   suite exercises the fetch-on-demand path a hand-built fixture is small
   enough to hit deliberately: totalCount is set ABOVE initialRows.length, so
   GraduatedBoard's own needsFetch gate is true and a sort/filter/page change
   reaches for /graduated.json exactly as it would in production. */

function row(i: number, overrides: Partial<GraduatedRow> = {}): GraduatedRow {
  const hex = i.toString(16).padStart(40, "0");
  return {
    token: `0x${hex}`,
    durationSeconds: 10 + i,
    graduatedAt: new Date(1_800_000_000_000 + i * 1000).toISOString(),
    launchedAt: new Date(1_800_000_000_000 + i * 1000 - 10_000).toISOString(),
    pairClass: i % 3 === 0 ? "eth" : i % 3 === 1 ? "stable" : null,
    creatorTaxBps: i % 2 === 0 ? 100 : null,
    ...overrides,
  };
}

const FULL_ROWS: GraduatedRow[] = Array.from({ length: 60 }, (_, i) => row(i));
const FIRST_PAGE = FULL_ROWS.slice(0, PAGE_SIZE);

const FULL_FILE: GraduatedFile = {
  generatedAt: "2026-09-10T12:00:00.000Z",
  staleAfterSeconds: 7200,
  totalGraduationRows: 60,
  excludedNoLaunch: 0,
  excludedUnmatched: 0,
  rows: FULL_ROWS,
};

function answerWith(payload: unknown) {
  const impl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
  vi.stubGlobal("fetch", impl);
  return impl;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("GraduatedBoard's build-time first page", () => {
  it("renders only the first page and states the true total, with no fetch, on first paint", () => {
    const fetchMock = answerWith(FULL_FILE);
    const { container } = render(<GraduatedBoard initialRows={FIRST_PAGE} totalCount={FULL_ROWS.length} />);
    const rows = container.querySelectorAll(".graduated-board tbody tr");
    expect(rows).toHaveLength(PAGE_SIZE);
    expect(container.textContent).toContain(`${PAGE_SIZE} of 60`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches /graduated.json and re-sorts across the whole record when a non-default sort is chosen", async () => {
    const fetchMock = answerWith(FULL_FILE);
    const { container } = render(<GraduatedBoard initialRows={FIRST_PAGE} totalCount={FULL_ROWS.length} />);

    const slowest = [...container.querySelectorAll(".live-sort a")].find((a) => a.textContent === "Slowest first")!;
    fireEvent.click(slowest);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/graduated.json"));
    await waitFor(() => expect(container.querySelectorAll(".graduated-board tbody tr").length).toBe(PAGE_SIZE));

    // slowest-first: the highest durationSeconds (row 59) leads
    const firstRow = container.querySelector(".graduated-board tbody tr th a");
    expect(firstRow?.getAttribute("title")).toBe(FULL_ROWS[59]!.token);
  });

  it("pages past the first 50 once the full record is fetched", async () => {
    answerWith(FULL_FILE);
    const { container } = render(<GraduatedBoard initialRows={FIRST_PAGE} totalCount={FULL_ROWS.length} />);

    const next = [...container.querySelectorAll(".pager a")].find((a) => a.textContent === "Next")!;
    fireEvent.click(next);

    await waitFor(() => expect(container.textContent).toContain("page 2 of 2"));
    const rows = container.querySelectorAll(".graduated-board tbody tr");
    expect(rows).toHaveLength(10); // 60 rows, page size 50 -> 10 on page 2
  });

  it("states its own filtered n, separately from the unfiltered total, and never renders a bare percentage", async () => {
    answerWith(FULL_FILE);
    const { container } = render(<GraduatedBoard initialRows={FIRST_PAGE} totalCount={FULL_ROWS.length} />);

    const pairSelect = container.querySelector('select[id]') as HTMLSelectElement;
    // the first picker-select in document order is the pair-token filter
    fireEvent.change(pairSelect, { target: { value: "eth" } });

    await waitFor(() => expect(container.textContent).toMatch(/of 20 matching tokens shown \(20 of 60 total\)/));
    expect(container.textContent ?? "").not.toMatch(/\d+\.\d+\s*%/);
  });

  it("carries the filter and the sort together in the address bar, merged rather than overwritten", async () => {
    answerWith(FULL_FILE);
    const { container } = render(<GraduatedBoard initialRows={FIRST_PAGE} totalCount={FULL_ROWS.length} />);

    const pairSelect = container.querySelector('select[id]') as HTMLSelectElement;
    fireEvent.change(pairSelect, { target: { value: "eth" } });
    await waitFor(() => expect(window.location.search).toContain("pair=eth"));

    const slowest = [...container.querySelectorAll(".live-sort a")].find((a) => a.textContent === "Slowest first")!;
    fireEvent.click(slowest);
    await waitFor(() => expect(window.location.search).toContain("sort=durationDesc"));
    expect(window.location.search).toContain("pair=eth");
  });

  it("resets every filter and returns to the unfiltered total on request", async () => {
    answerWith(FULL_FILE);
    const { container } = render(<GraduatedBoard initialRows={FIRST_PAGE} totalCount={FULL_ROWS.length} />);

    const pairSelect = container.querySelector('select[id]') as HTMLSelectElement;
    fireEvent.change(pairSelect, { target: { value: "eth" } });
    await waitFor(() => expect(container.textContent).toContain("matching tokens shown"));

    const reset = container.querySelector(".board-filters-reset") as HTMLAnchorElement;
    expect(reset).toBeTruthy();
    fireEvent.click(reset);

    await waitFor(() => expect(container.textContent).toContain(`${PAGE_SIZE} of 60 graduated tokens shown`));
    expect(container.querySelector(".board-filters-reset")).toBeNull();
  });
});
