import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GraveyardBoard } from "../components/Graveyard";
import graveyard from "./api-fixtures/graveyard-ok.json";
import { PAGE_SIZE, totalPagesFor } from "../lib/paginate";

/* /graveyard, like /live, already fetches every row it will hold for a sort
   in one request, so pagination and filters narrow what is already in hand
   (REVAMP.md). 55 synthetic rows, built off graveyard-ok.json's own row 0,
   exercise a second page and the graveyard's own filter set: pair token,
   creator tax band, and age. */

function syntheticRows(n: number) {
  const template = graveyard.rows[0]!;
  return Array.from({ length: n }, (_, i) => ({
    ...template,
    token: `0x${i.toString(16).padStart(40, "0")}`,
    pairClass: i % 2 === 0 ? "eth" : "stable",
    creatorTaxBps: i % 2 === 0 ? 0 : 300,
    ageSeconds: 259200 + i * 100,
    firstBlockBuyers: 0,
  }));
}

const ROWS = syntheticRows(55);
const PAYLOAD = { ...graveyard, rows: ROWS, count: ROWS.length };

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

describe("the graveyard's pagination", () => {
  it("shows only the first page and states its size of 55, with a working pager", async () => {
    answerWith(PAYLOAD);
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(PAGE_SIZE));
    expect(container.textContent).toContain(`${PAGE_SIZE} of 55 launches at zero buys`);
    const pages = totalPagesFor(55);
    expect(container.textContent).toContain(`page 1 of ${pages}`);

    const next = [...container.querySelectorAll(".pager a")].find((a) => a.textContent === "Next")!;
    fireEvent.click(next);
    const secondPageRows = pages === 2 ? 55 - PAGE_SIZE : PAGE_SIZE;
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(secondPageRows));
  });
});

describe("the graveyard's filters", () => {
  it("narrows by pair token, stating its own n against the unfiltered total", async () => {
    answerWith(PAYLOAD);
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(PAGE_SIZE));

    const pairSelect = screen.getByLabelText("Pair token") as HTMLSelectElement;
    fireEvent.change(pairSelect, { target: { value: "stable" } });

    // 55 rows, odd index -> stable: 27
    await waitFor(() => expect(container.textContent).toMatch(/of 27 matching launches shown \(27 of 55 total\)/));
  });

  it("narrows by age with a numeric lower bound", async () => {
    answerWith(PAYLOAD);
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(PAGE_SIZE));

    const ageFromInput = [...container.querySelectorAll("input[type=number]")][0] as HTMLInputElement;
    fireEvent.change(ageFromInput, { target: { value: String(259200 + 50 * 100) } });

    // ageSeconds = 259200 + i*100 >= 259200+5000 -> i >= 50 -> rows 50..54 (5 rows)
    await waitFor(() => expect(container.textContent).toMatch(/of 5 matching launches shown \(5 of 55 total\)/));
  });
});
