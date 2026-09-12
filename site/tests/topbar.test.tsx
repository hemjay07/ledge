import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "../components/TopBar";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* The shell, mounted once in app/layout.tsx on 2026-09-11.

   Until then each of eight pages rendered its own copy of the navigation, and
   each page's own test asserted that every destination was reachable from it.
   Those assertions guarded something real — CONSTRAINTS 5's guarantee is about
   reachability, and a page that quietly stopped linking somewhere would have
   hidden it. So the guarantee did not get deleted with the per-page nav; it
   moved here, where it is asserted once against the thing every page now
   carries. */
describe("the shell's reachability guarantee", () => {
  const DESTINATIONS = [
    "/",
    "/live",
    "/graduated",
    "/graveyard",
    "/token",
    "/number",
    "/cohorts",
    "/cockpit",
    "/method",
    "/number.json",
  ];

  it("reaches every published surface from every page", () => {
    const { container } = render(<TopBar />);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    for (const href of DESTINATIONS) {
      expect(hrefs, `${href} is not reachable from the shell`).toContain(href);
    }
  });

  /* The reference links are hidden rather than unmounted, so they are in the
     document for a crawler and for a reader whose JavaScript has not run. A
     destination that only exists after a click is not reachable. */
  it("keeps the reference links in the document when they are collapsed", () => {
    const { container } = render(<TopBar />);
    const panel = container.querySelector("#topbar-reference");
    expect(panel?.hasAttribute("hidden")).toBe(true);
    expect([...panel!.querySelectorAll("a")].length).toBe(5);
  });

  it("opens and closes the reference disclosure", () => {
    const { container } = render(<TopBar />);
    const button = container.querySelector(".topbar-more") as HTMLButtonElement;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("#topbar-reference")?.hasAttribute("hidden")).toBe(false);
  });
});

describe("the shell's address field", () => {
  it("takes a bare address to that token's own page", () => {
    const address = "0x5c8e7902ea8025221d9976cb284b3bed020bd41d";
    const { container } = render(<TopBar />);
    const input = container.querySelector(".topbar-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: address } });

    const assigned: string[] = [];
    vi.stubGlobal("window", {
      ...window,
      location: { get href() { return ""; }, set href(v: string) { assigned.push(v); } },
    });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(assigned).toEqual([`/t/${address}`]);
  });

  /* People copy URLs, not addresses. A pasted launch link has to work. */
  it("takes an address out of a pasted URL", () => {
    const address = "0x5c8e7902ea8025221d9976cb284b3bed020bd41d";
    const { container } = render(<TopBar />);
    const input = container.querySelector(".topbar-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: `https://ponsfamily.com/token/${address}?ref=x` } });

    const assigned: string[] = [];
    vi.stubGlobal("window", {
      ...window,
      location: { get href() { return ""; }, set href(v: string) { assigned.push(v); } },
    });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(assigned).toEqual([`/t/${address}`]);
  });

  it("says so, and navigates nowhere, when the input is not an address", () => {
    const { container } = render(<TopBar />);
    const input = container.querySelector(".topbar-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "not an address" } });

    const assigned: string[] = [];
    vi.stubGlobal("window", {
      ...window,
      location: { get href() { return ""; }, set href(v: string) { assigned.push(v); } },
    });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(assigned).toEqual([]);
    expect(container.querySelector(".topbar-problem")?.textContent).toMatch(/not a 20-byte address/i);
  });

  /* CONSTRAINTS 3 applies to the shell as much as to a page: a figure here
     would carry no denominator and no window, so there are no figures here. */
  it("prints no figure of its own", () => {
    const { container } = render(<TopBar />);
    expect(container.textContent ?? "").not.toMatch(/\d[\d,.]*\s*%/);
  });
});
