import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Method from "../app/method/page";

/* /method (2026-09-17): a five-line brief at the top, every long section
   folded, and the pre-registration pointing at /launch. The brief restates
   METHOD.md; if a definition moves, the line moves with it. */

afterEach(cleanup);

describe("/method", () => {
  it("opens with the five-line brief", () => {
    const { container } = render(<Method />);
    const items = container.querySelectorAll(".method-brief li");
    expect(items.length).toBe(5);
    const text = container.querySelector(".method-brief")?.textContent ?? "";
    expect(text).toContain("PoolGraduated");
    expect(text).toContain("300 seconds");
    expect(text).toContain("not enough data (n=");
    expect(text).toContain("every 10 minutes");
  });

  it("folds the definitions, the comparison and the changelog, and keeps the recompute command open", () => {
    const { container } = render(<Method />);
    expect(container.querySelector("details #h-definitions")).not.toBeNull();
    expect(container.querySelector("details table caption")?.textContent).toContain("side by side");
    expect(container.querySelector("details #h-changelog")).not.toBeNull();
    expect(container.querySelector("details pre.cmd")).toBeNull();
    expect(container.querySelector("pre.cmd")?.textContent).toContain("recompute.py --check");
  });

  it("points the pre-registration at its own page and keeps the full text", () => {
    const { container } = render(<Method />);
    expect(container.querySelector('a[href="/launch"]')).not.toBeNull();
    expect(container.querySelector("details #h-preregistration-text")).not.toBeNull();
  });
});
