import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { LiveBoardFull } from "../components/Live";
import live from "./api-fixtures/live-ok.json";
import { PAGE_SIZE } from "../lib/paginate";

/* /live already fetches every row it will hold for a sort in one request
   (the API caps at 200), so pagination and filters here narrow what is
   already in hand rather than triggering a second fetch (REVAMP.md: "/live
   and /graveyard already fetch their rows from the API at runtime, so those
   paginate client-side from what they already hold"). 60 synthetic rows,
   built off live-ok.json's own row 0, exercise a second page and every
   filter dimension the live board is required to carry: pair token,
   creator tax band, whether it has taken any buys, and age. */

function syntheticRows(n: number) {
  const template = live.rows[0]!;
  return Array.from({ length: n }, (_, i) => ({
    ...template,
    token: `0x${i.toString(16).padStart(40, "0")}`,
    pairClass: i % 3 === 0 ? "eth" : i % 3 === 1 ? "stable" : "other",
    creatorTaxBps: i % 2 === 0 ? 0 : 300,
    buys: i % 4 === 0 ? 0 : 5,
    ageSeconds: i * 10,
    lastActivityAt: template.lastActivityAt,
  }));
}

const ROWS = syntheticRows(60);
const PAYLOAD = { ...live, rows: ROWS, count: ROWS.length };

function answerWith(payload: unknown) {
  const impl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
  vi.stubGlobal("fetch", impl);
  return impl;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("the live board's pagination", () => {
  it("shows only the first 50 rows and states 50 of 60, with a working pager", async () => {
    answerWith(PAYLOAD);
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(PAGE_SIZE));
    expect(container.textContent).toContain(`${PAGE_SIZE} of 60 tokens with activity in this window shown`);
    expect(container.textContent).toContain("page 1 of 2");

    const next = [...container.querySelectorAll(".pager a")].find((a) => a.textContent === "Next")!;
    fireEvent.click(next);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(10));
    expect(container.textContent).toContain("page 2 of 2");
  });

  it("carries the page across a sort change by resetting to page 1, and the URL follows", async () => {
    answerWith(PAYLOAD);
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(PAGE_SIZE));

    const next = [...container.querySelectorAll(".pager a")].find((a) => a.textContent === "Next")!;
    fireEvent.click(next);
    await waitFor(() => expect(window.location.search).toContain("page=2"));

    const buys = [...container.querySelectorAll('nav[aria-label="Sort the live board"] a')].find(
      (a) => a.textContent === "Most buys",
    )!;
    fireEvent.click(buys);
    await waitFor(() => expect(window.location.search).not.toContain("page=2"));
  });
});

describe("the live board's filters", () => {
  it("narrows by pair token and states its own n against the unfiltered total", async () => {
    answerWith(PAYLOAD);
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(PAGE_SIZE));

    const pairSelect = container.querySelector('select[id]') as HTMLSelectElement;
    fireEvent.change(pairSelect, { target: { value: "eth" } });

    await waitFor(() => expect(container.textContent).toMatch(/of 20 matching tokens shown \(20 of 60 total\)/));
    expect(container.querySelectorAll("tbody tr").length).toBe(20);
  });

  it("narrows by whether a token has taken any buys, naming the column rather than a verdict", async () => {
    answerWith(PAYLOAD);
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(PAGE_SIZE));

    const buysSelect = [...container.querySelectorAll("select")].find((s) =>
      [...s.querySelectorAll("option")].some((o) => o.textContent === "Has taken no buys"),
    ) as HTMLSelectElement;
    fireEvent.change(buysSelect, { target: { value: "no" } });

    // 60 rows, i % 4 === 0 -> buys 0: 15 rows
    await waitFor(() => expect(container.textContent).toMatch(/of 15 matching tokens shown \(15 of 60 total\)/));
  });

  it("resets every filter and returns to the unfiltered count", async () => {
    answerWith(PAYLOAD);
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(PAGE_SIZE));

    const pairSelect = container.querySelector('select[id]') as HTMLSelectElement;
    fireEvent.change(pairSelect, { target: { value: "eth" } });
    await waitFor(() => expect(container.textContent).toContain("matching tokens shown"));

    const reset = container.querySelector(".board-filters-reset") as HTMLAnchorElement;
    fireEvent.click(reset);
    await waitFor(() =>
      expect(container.textContent).toContain(`${PAGE_SIZE} of 60 tokens with activity in this window shown`),
    );
  });
});
