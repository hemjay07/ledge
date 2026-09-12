import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LiveBoardFull } from "../components/Live";
import { __clearTokenPanelCacheForTests } from "../components/TokenPanel";
import live from "./api-fixtures/live-ok.json";
import tokenOk from "./api-fixtures/token-ok.json";
import tokenBuyersZero from "./api-fixtures/token-panel-buyers-zero.json";
import tokenBuyersNotIndexed from "./api-fixtures/token-panel-buyers-not-indexed.json";

/* Clicking a row opens a panel with that token's own facts, without a page
   load and without losing the board underneath it (REVAMP.md 1.1). These
   tests exercise the panel through the live board, the way a reader actually
   reaches it -- the panel itself renders the same objects Lookup.tsx already
   renders (lib/api.ts fetchToken / splitLookupText), so what is asserted here
   is the panel's OWN behaviour: how it opens, what order it puts the API's
   sentences in, and how it closes -- not a second rendering of the sentences
   themselves, which lookup.test.tsx already covers line for line. */

const FIRST_ROW_TOKEN = live.rows[0]!.token;

function answerWith() {
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/live")) {
      return new Response(JSON.stringify(live), { status: 200 });
    }
    if (url.includes(`/api/token/${FIRST_ROW_TOKEN}`)) {
      return new Response(JSON.stringify({ ...tokenOk, address: FIRST_ROW_TOKEN }), { status: 200 });
    }
    return new Response(JSON.stringify({ schemaVersion: 1, error: "unreadable", message: "no fixture" }), {
      status: 500,
    });
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

async function renderBoardWithOpenPanel(): Promise<{ container: HTMLElement; row: HTMLElement }> {
  const fetchMock = answerWith();
  const { container } = render(<LiveBoardFull />);
  await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(0));
  const row = container.querySelector("tbody tr") as HTMLElement;
  fireEvent.click(row);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/token/"), expect.anything()));
  await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  return { container, row };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  __clearTokenPanelCacheForTests();
});

describe("opening the panel", () => {
  it("opens from clicking anywhere on the row, not only the address link", async () => {
    const fetchMock = answerWith();
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(0));
    const row = container.querySelector("tbody tr") as HTMLElement;
    // Click a plain cell, not the address anchor.
    const plainCell = row.querySelector("td") as HTMLElement;
    fireEvent.click(plainCell);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/api/token/${FIRST_ROW_TOKEN}`), expect.anything());
  });

  it("does not fetch the token until the row is clicked", async () => {
    const fetchMock = answerWith();
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(0));
    const calledUrls = (fetchMock.mock.calls as unknown as unknown[][]).map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("/api/token/"))).toBe(false);
  });

  it("puts the token's own address in the query string, merged with any existing params", async () => {
    window.history.replaceState(null, "", "/live?sort=buys");
    await renderBoardWithOpenPanel();
    const params = new URLSearchParams(window.location.search);
    expect(params.get("token")).toBe(FIRST_ROW_TOKEN);
    expect(params.get("sort")).toBe("buys");
  });

  it("is a labelled dialog naming the token, with aria-modal", async () => {
    await renderBoardWithOpenPanel();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const label = document.getElementById(labelledBy as string);
    expect(label?.textContent ?? "").toMatch(/^0x/);
  });

  it("moves focus into the panel on open", async () => {
    await renderBoardWithOpenPanel();
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("opens from the keyboard, not only a click", async () => {
    const fetchMock = answerWith();
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(0));
    const row = container.querySelector("tbody tr") as HTMLElement;
    fireEvent.keyDown(row, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/api/token/${FIRST_ROW_TOKEN}`), expect.anything());
  });

  it("traps Tab inside the panel: forward from the last focusable wraps to the first", async () => {
    await renderBoardWithOpenPanel();
    const dialog = screen.getByRole("dialog");
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("traps Tab inside the panel: backward (Shift+Tab) from the first wraps to the last", async () => {
    await renderBoardWithOpenPanel();
    const dialog = screen.getByRole("dialog");
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("does not refetch a token it already holds", async () => {
    const fetchMock = answerWith();
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(0));
    const row = container.querySelector("tbody tr") as HTMLElement;
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    const callsAfterFirstOpen = (fetchMock.mock.calls as unknown as unknown[][]).filter((c) =>
      String(c[0]).includes("/api/token/"),
    ).length;
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    const callsAfterReopen = (fetchMock.mock.calls as unknown as unknown[][]).filter((c) =>
      String(c[0]).includes("/api/token/"),
    ).length;
    expect(callsAfterReopen).toBe(callsAfterFirstOpen);
  });
});

describe("closing the panel", () => {
  it("closes on Escape and returns focus to the row that opened it", async () => {
    const { row } = await renderBoardWithOpenPanel();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(row);
  });

  it("closes on clicking the backdrop", async () => {
    await renderBoardWithOpenPanel();
    const backdrop = document.querySelector(".panel-backdrop") as HTMLElement;
    fireEvent.mouseDown(backdrop);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("does not close when the panel's own content is clicked", async () => {
    await renderBoardWithOpenPanel();
    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(dialog);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("closes on the explicit close control", async () => {
    const { row } = await renderBoardWithOpenPanel();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(row);
  });

  it("removes ?token= from the address bar on close", async () => {
    await renderBoardWithOpenPanel();
    expect(new URLSearchParams(window.location.search).get("token")).toBe(FIRST_ROW_TOKEN);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("token")).toBeNull(),
    );
  });
});

/* 2026-09-12: the panel shows the facts from the structured body, not the
   bot's sentences (which stay on the full page, folded). Same facts, same
   order, same guards -- asserted on the figures rather than on sentences. */
describe("what the panel shows, and in what order", () => {
  it("states the fill against this launch's own threshold, both figures and the share", async () => {
    await renderBoardWithOpenPanel();
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("Fill"));
    expect(dialog.textContent).toContain("1.7432 of 4.2 ETH · 41.5%");
  });

  it("states buys and sells since launch", async () => {
    await renderBoardWithOpenPanel();
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("Since launch"));
    expect(dialog.textContent).toContain("41 buys · 12 sells");
  });

  it("states the cohort with its own n", async () => {
    await renderBoardWithOpenPanel();
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("of 2,324, all time"));
  });

  it("places buyers before the fill, the fill before the activity counts, and the activity before the cohort", async () => {
    await renderBoardWithOpenPanel();
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("Buyers in the launch block"));
    const text = dialog.textContent ?? "";
    const buyersAt = text.indexOf("Buyers in the launch block");
    const fillAt = text.indexOf("Fill");
    const activityAt = text.indexOf("Since launch");
    const cohortAt = text.indexOf("Launches like it");
    expect(buyersAt).toBeGreaterThan(-1);
    expect(buyersAt).toBeLessThan(fillAt);
    expect(fillAt).toBeLessThan(activityAt);
    expect(activityAt).toBeLessThan(cohortAt);
  });

  it("carries a plain link to the full /t/{address} page", async () => {
    await renderBoardWithOpenPanel();
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.querySelector(`a[href="/t/${FIRST_ROW_TOKEN}"]`)).toBeTruthy());
  });

  it("says nothing a reader could act on -- no score, grade, badge or verdict vocabulary", async () => {
    await renderBoardWithOpenPanel();
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("Fill"));
    const text = (dialog.textContent ?? "").toLowerCase();
    for (const word of ["score", "grade", "badge", "risk", "safe", "rug", "likely", "predict", "odds", "chance"]) {
      expect(text).not.toContain(word);
    }
  });
});

describe("null versus zero distinct buyers", () => {
  function answerWithToken(payload: unknown) {
    const impl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/live")) return new Response(JSON.stringify(live), { status: 200 });
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    vi.stubGlobal("fetch", impl);
    return impl;
  }

  it("reads a block that was indexed with nobody buying as a zero, not as absent", async () => {
    answerWithToken({ ...tokenBuyersZero, address: FIRST_ROW_TOKEN });
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(0));
    fireEvent.click(container.querySelector("tbody tr") as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("Buyers in the launch block"));
    const value = dialog.querySelector(".panel-fact .panel-fact-v")?.textContent ?? "";
    expect(value.trim()).toBe("0");
  });

  it("reads a block that was never indexed as not indexed, never as a zero reading", async () => {
    answerWithToken({ ...tokenBuyersNotIndexed, address: FIRST_ROW_TOKEN });
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(0));
    fireEvent.click(container.querySelector("tbody tr") as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("Buyers in the launch block"));
    const value = dialog.querySelector(".panel-fact .panel-fact-v")?.textContent ?? "";
    expect(value.trim()).toBe("not read");
  });
});
