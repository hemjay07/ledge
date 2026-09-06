import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Age } from "../components/Age";
import { StaleBanner } from "../components/StaleBanner";

const CRAWLED_AT = "2026-09-06T15:58:32Z";
const STALE_AFTER = 7200;

function atAge(seconds: number) {
  vi.setSystemTime(new Date(Date.parse(CRAWLED_AT) + seconds * 1000));
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the age of a measurement", () => {
  it("counts up from crawledAt once the browser has a clock", () => {
    atAge(720);
    render(<Age crawledAt={CRAWLED_AT} staleAfterSeconds={STALE_AFTER} />);
    expect(screen.getByText("12 min")).toBeTruthy();
  });

  it("marks the age when the measurement has gone stale", () => {
    atAge(7260);
    render(<Age crawledAt={CRAWLED_AT} staleAfterSeconds={STALE_AFTER} />);
    expect(screen.getByText("2 h").className).toContain("is-stale");
  });

  it("does not mark the age while the measurement is fresh", () => {
    atAge(7140);
    render(<Age crawledAt={CRAWLED_AT} staleAfterSeconds={STALE_AFTER} />);
    expect(screen.getByText("2 h").className).not.toContain("is-stale");
  });
});

describe("the correction slip", () => {
  it("is absent at 1 h 59 min", () => {
    atAge(7140);
    const { container } = render(
      <StaleBanner crawledAt={CRAWLED_AT} staleAfterSeconds={STALE_AFTER} />,
    );
    expect(container.querySelector(".stale-slip")?.hasAttribute("hidden")).toBe(true);
  });

  it("is pasted across the sheet at 2 h 01 min, naming the last good measurement", () => {
    atAge(7260);
    const { container } = render(
      <StaleBanner crawledAt={CRAWLED_AT} staleAfterSeconds={STALE_AFTER} />,
    );
    expect(container.querySelector(".stale-slip")?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByRole("status").textContent).toBe(
      "This number is 2 h old. Last successful measurement 15:58 UTC, 6 September 2026.",
    );
    expect(document.documentElement.dataset.stale).toBe("true");
  });
});

/* W14: a crawledAt the clock cannot read is not a fresh measurement. NaN
   propagates silently — `NaN >= staleAfterSeconds` is false — so an unguarded
   age renders a sheet of unknown vintage as fresh, and prints "NaN d ago". */
describe("a measurement time nothing can read", () => {
  const UNREADABLE = "not-a-timestamp";

  it("never prints NaN as an age", () => {
    atAge(720);
    const { container } = render(
      <Age crawledAt={UNREADABLE} staleAfterSeconds={STALE_AFTER} />,
    );
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).toContain("an unreadable time");
  });

  it("is marked stale rather than left looking fresh", () => {
    atAge(0);
    const { container } = render(
      <Age crawledAt={UNREADABLE} staleAfterSeconds={STALE_AFTER} />,
    );
    expect(container.querySelector(".is-stale")).not.toBeNull();
  });

  it("pastes the correction slip, and prints no NaN on it", () => {
    atAge(0);
    const { container } = render(
      <StaleBanner crawledAt={UNREADABLE} staleAfterSeconds={STALE_AFTER} />,
    );
    expect(container.querySelector(".stale-slip")?.hasAttribute("hidden")).toBe(false);
    const said = screen.getByRole("status").textContent ?? "";
    expect(said).not.toContain("NaN");
    expect(said).toContain("Treat this sheet as stale.");
  });
});
