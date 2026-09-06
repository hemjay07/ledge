import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Register } from "../components/Register";
import { Stat, type StatProps } from "../components/Stat";

afterEach(cleanup);

/* A poster percentage is marked up as digits plus a <span class="pct">%</span>,
   so the sign can be set at its own size. getByText concatenates only an
   element's direct text nodes, so it cannot see a value split that way. This
   finds the stat itself and asserts its full rendered text — the same string
   the reader sees, and the same string these tests asserted before the sign
   was given its own span. */
function statByText(text: string): HTMLElement {
  return screen.getByText(
    (_content, el) => el?.tagName === "SPAN" && el.textContent === text,
  );
}

const base = {
  value: 0.018524,
  n: 3347,
  window: "24h",
  updatedAt: "2026-09-06T15:58:32Z",
} satisfies StatProps;

describe("the denominator rule", () => {
  it("is a type error to omit n, and a throw at runtime", () => {
    // @ts-expect-error a rate does not render without its denominator
    const withoutN: StatProps = { value: 0.018524, window: "24h", updatedAt: base.updatedAt };
    expect(() => Stat(withoutN)).toThrow(/missing n/);
  });

  it("refuses a figure with no window", () => {
    // @ts-expect-error a figure does not render without the window it was computed over
    const withoutWindow: StatProps = { value: 0.018524, n: 3347, updatedAt: base.updatedAt };
    expect(() => Stat(withoutWindow)).toThrow(/missing window/);
  });

  it("refuses a figure with no measurement time", () => {
    // @ts-expect-error a figure does not render without the crawl it came from
    const withoutUpdated: StatProps = { value: 0.018524, n: 3347, window: "24h" };
    expect(() => Stat(withoutUpdated)).toThrow(/missing updatedAt/);
  });

  it("names every missing part in one message", () => {
    expect(() => Stat({ value: 1, n: Number.NaN, window: "", updatedAt: "" } as StatProps)).toThrow(
      /missing n, window, updatedAt/,
    );
  });

  it("writes the denominator into the markup beside the value", () => {
    render(<Stat {...base} name="pons-number" />);
    const el = statByText("1.85%");
    expect(el.dataset.n).toBe("3347");
    expect(el.dataset.window).toBe("24h");
    expect(el.dataset.updated).toBe("2026-09-06T15:58:32Z");
    expect(el.getAttribute("aria-label")).toContain("3,347");
  });
});

describe("an under-sampled figure", () => {
  it("prints its sample size instead of a percentage below n = 30", () => {
    render(<Stat {...base} value={0.5} n={26} />);
    expect(screen.getByText("not enough data (n=26)")).toBeTruthy();
    expect(screen.queryByText("50.0%")).toBeNull();
  });

  it("prints its sample size when the pipeline marked it insufficient", () => {
    render(<Stat {...base} value={null} n={3347} insufficient />);
    expect(screen.getByText("not enough data (n=3347)")).toBeTruthy();
  });

  it("renders a rate at exactly n = 30 and not at n = 29", () => {
    const { unmount } = render(<Stat {...base} value={0.1} n={30} />);
    expect(statByText("10.0%")).toBeTruthy();
    unmount();
    render(<Stat {...base} value={0.1} n={29} />);
    expect(screen.getByText("not enough data (n=29)")).toBeTruthy();
  });
});

describe("the register", () => {
  it("refuses a table with no sample-size column", () => {
    expect(() =>
      Register({
        columns: ["Pair token", "Graduations", "Rate"],
        rows: [{ label: "ETH", cells: [{ text: "13" }, { text: "0.89%" }] }],
        foot: { label: "All", cells: [{ text: "62" }, { text: "1.85%" }] },
        caption: "x",
        ariaLabel: "by pair token",
      }),
    ).toThrow(/no sample-size column/);
  });

  it("renders the All footing so buckets can be checked against the population", () => {
    render(
      <Register
        columns={["Pair token", "Launches (n)", "Graduations", "Rate"]}
        rows={[
          {
            label: "ETH",
            cells: [{ text: "1,457", kind: "n" }, { text: "13", kind: "n" }, { text: "0.89%" }],
          },
        ]}
        foot={{ label: "All", cells: [{ text: "3,347" }, { text: "62" }, { text: "1.85%" }] }}
        caption="Graduations of launches, by the token the pool is paired against."
        ariaLabel="Graduation rate by pair token"
      />,
    );
    expect(screen.getByText("All")).toBeTruthy();
    expect(screen.getByText("Launches (n)")).toBeTruthy();
    expect(screen.getByText("1,457")).toBeTruthy();
  });
});
