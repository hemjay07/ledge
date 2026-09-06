import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { LiveBoard } from "../components/LiveBoard";
import live from "./api-fixtures/live-ok.json";

const ADDRESS = "0x23fe54b3bf9e1d2816822043c0b02b6a12f98fe2";

function answerWith(payload: unknown) {
  const impl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
  vi.stubGlobal("fetch", impl);
  return impl;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the last launches board", () => {
  it("prints one row per launch, with no address and no ticker", async () => {
    answerWith(live);
    const { container } = render(<LiveBoard folio="04" />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(4));
    const text = container.textContent ?? "";
    expect(text).toContain("ETH");
    expect(text).toContain("2–3%");
    expect(text).toContain("graduated");
    expect(text).toContain("on the curve");
    expect(text).not.toMatch(/0x[0-9a-f]{40}/i);
  });

  it("names a launch whose tax was not read, rather than printing a bucket it has no right to", async () => {
    answerWith(live);
    const { container } = render(<LiveBoard folio="04" />);
    await waitFor(() => expect(container.textContent).toContain("tax not read"));
  });

  it("strips a 20-byte address defensively, even if the API sends one", async () => {
    answerWith({
      ...live,
      rows: [{ pairClass: ADDRESS, taxBucket: ADDRESS, ageSeconds: 30, graduated: false }],
      count: 1,
    });
    const { container } = render(<LiveBoard folio="04" />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(1));
    expect(container.textContent ?? "").not.toMatch(/0x[0-9a-f]{40}/i);
  });

  it("carries the count and the age of the reading in its heading", async () => {
    answerWith(live);
    const { container } = render(<LiveBoard folio="04" />);
    await waitFor(() => expect(container.querySelector("h2")?.textContent).toMatch(/updated .* ago/));
    const heading = container.querySelector("h2")?.textContent ?? "";
    expect(heading).toContain("Last launches");
    expect(heading).toContain("4 launches");
  });

  it("re-reads the board every 15 seconds", async () => {
    vi.useFakeTimers();
    const fetchMock = answerWith(live);
    render(<LiveBoard folio="04" />);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops reading when it leaves the page", async () => {
    vi.useFakeTimers();
    const fetchMock = answerWith(live);
    const { unmount } = render(<LiveBoard folio="04" />);
    await vi.advanceTimersByTimeAsync(0);
    unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says the board did not answer rather than showing an empty table as though it had", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const { container } = render(<LiveBoard folio="04" />);
    await waitFor(() => expect(container.textContent).toContain("did not answer"));
  });

  it("prints no rate, so there is no denominator to omit", async () => {
    answerWith(live);
    const { container } = render(<LiveBoard folio="04" />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(4));
    expect(container.textContent ?? "").not.toMatch(/\d+\.\d+\s*%/);
  });
});
