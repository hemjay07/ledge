import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Lookup } from "../components/Lookup";
import ok from "./api-fixtures/token-ok.json";
import notIndexed from "./api-fixtures/token-not-indexed.json";
import insufficient from "./api-fixtures/token-insufficient.json";
import notPons from "./api-fixtures/error-not-a-pons-token.json";
import rpcDown from "./api-fixtures/error-rpc-down.json";
import badAddress from "./api-fixtures/error-bad-address.json";

/* The lookup renders the API's sentences and nothing else. These tests read
   the DOM's text and compare it with the fixture's own `text` block, so a
   reworded, rebuilt or recomputed sentence fails here. */

const ADDRESS = "0x23fe54b3bf9e1d2816822043c0b02b6a12f98fe2";

function answerWith(payload: unknown): typeof fetch {
  const impl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
  vi.stubGlobal("fetch", impl);
  return impl as unknown as typeof fetch;
}

async function lookUp(payload: unknown, typed = ADDRESS): Promise<HTMLElement> {
  const fetchMock = answerWith(payload);
  const { container } = render(<Lookup />);
  const input = screen.getByLabelText(/paste a pons token address/i) as HTMLInputElement;
  const { fireEvent } = await import("@testing-library/react");
  fireEvent.change(input, { target: { value: typed } });
  fireEvent.click(screen.getByRole("button", { name: /look up/i }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  return container as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the field", () => {
  it("is a labelled text input and a submit, and nothing else", () => {
    render(<Lookup />);
    expect(screen.getByLabelText(/paste a pons token address or ponsfamily.com launch url/i))
      .toBeTruthy();
    expect(screen.getByRole("button", { name: /look up/i }).getAttribute("type")).toBe("submit");
  });

  it("holds one input, so Enter submits the form", () => {
    const { container } = render(<Lookup />);
    expect(container.querySelectorAll("input").length).toBe(1);
    expect(container.querySelector("form")).toBeTruthy();
  });

  it("asks nothing of the reader before it will answer", () => {
    const { container } = render(<Lookup />);
    const text = container.textContent ?? "";
    expect(text.toLowerCase()).not.toContain("wallet");
    expect(text.toLowerCase()).not.toContain("email");
    expect(text.toLowerCase()).not.toContain("sign");
  });

  it("does not call the API for an empty field", async () => {
    const fetchMock = answerWith(ok);
    render(<Lookup />);
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("a full lookup", () => {
  it("prints every sentence the API sent, verbatim", async () => {
    const container = await lookUp(ok);
    await waitFor(() => expect(container.textContent).toContain("minute 13"));
    const text = container.textContent ?? "";
    for (const line of ok.text.split("\n")) {
      if (line.startsWith("https://")) continue; // the method URL is the entry's link target
      expect(text).toContain(line);
    }
  });

  it("carries the config line, the cohort with its n, and the placement", async () => {
    const container = await lookUp(ok);
    await waitFor(() => expect(container.textContent).toContain("ETH · 2–3%"));
    const text = container.textContent ?? "";
    expect(text).toContain("on the bonding curve");
    expect(text).toContain("of 2,324 graduated");
    expect(text).toContain("had already happened");
    expect(text).toContain("Curve fill:");
  });

  it("links the entry to the card at /t/{address}", async () => {
    const container = await lookUp(ok);
    await waitFor(() => expect(container.querySelector("a")).toBeTruthy());
    expect(container.querySelector("a")?.getAttribute("href")).toBe(`/t/${ADDRESS}`);
  });

  it("says nothing a reader could act on", async () => {
    const container = await lookUp(ok);
    await waitFor(() => expect(container.textContent).toContain("minute 13"));
    const text = (container.textContent ?? "").toLowerCase();
    for (const word of ["score", "risk", "safe", "rug", "likely", "predict", "odds", "chance"]) {
      expect(text).not.toContain(word);
    }

    /* "buy" and "sell" were banned here as bare substrings until the lookup
       started stating a token's own indexed activity, which counts its buys
       and its sells. "41 buys" is a count of what happened, which CONSTRAINTS
       1 explicitly permits a per-token page to state; "buy this" would be the
       instruction it bans. The substring ban could not tell those apart and
       failed on the count, so it is replaced by patterns that match the
       instruction and not the noun. These are narrower in what they match and
       stricter about what they forbid: an imperative, a second person, or any
       sentence aimed at the reader. */
    for (const instruction of [
      /\bbuy (this|it|in|now)\b/,
      /\bsell (this|it|now)\b/,
      /\bape\b/,
      /\byou (should|can|could|might|will)\b/,
      /\b(don'?t|do not) (buy|sell|touch)\b/,
      /\bworth (buying|a buy|holding)\b/,
      /\b(avoid|consider|recommend)\b/,
    ]) {
      expect(text).not.toMatch(instruction);
    }
  });
});

describe("a partial", () => {
  it("prints the objection and the four facts that survived it", async () => {
    const container = await lookUp(notIndexed);
    await waitFor(() => expect(container.textContent).toContain("launch time not indexed"));
    const text = container.textContent ?? "";
    expect(text).toContain(notIndexed.message);
    expect(text).toContain("ETH · 2–3%");
    expect(text).toContain("of 2,324 graduated");
    expect(text).toContain("is not placed on the table of graduation times");
  });
});

describe("an under-sampled cohort", () => {
  it("prints no percentage anywhere in the entry", async () => {
    const container = await lookUp(insufficient);
    await waitFor(() => expect(container.textContent).toContain("not enough data (n=12)"));
    expect(container.textContent ?? "").not.toMatch(/\d+\.\d+\s*%/);
  });
});

describe("an error", () => {
  it("prints not_a_pons_token in the API's words, and no entry", async () => {
    const container = await lookUp(notPons, "0x0000000000000000000000000000000000000000");
    await waitFor(() => expect(container.textContent).toContain(notPons.message));
    expect(container.querySelector(".lookup-entry")).toBeNull();
  });

  it("prints rpc_down in the API's words, estimating nothing", async () => {
    const container = await lookUp(rpcDown);
    await waitFor(() => expect(container.textContent).toContain(rpcDown.message));
    expect(container.textContent).toContain("Nothing is being estimated");
  });

  it("prints bad_address in the API's words when the input holds no address", async () => {
    const container = await lookUp(badAddress, "not an address");
    await waitFor(() => expect(container.textContent).toContain(badAddress.message));
  });

  it("sends what was typed, so the API states the objection", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(badAddress), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Lookup />);
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(screen.getByLabelText(/paste a pons token address/i), {
      target: { value: "ponsfamily.com/whatever" },
    });
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String((fetchMock.mock.calls as unknown as unknown[][])[0]?.[0]);
    expect(url).toContain(
      encodeURIComponent("ponsfamily.com/whatever"),
    );
  });

  it("says the lookup did not answer when the network fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    render(<Lookup />);
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(screen.getByLabelText(/paste a pons token address/i), {
      target: { value: ADDRESS },
    });
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
    await waitFor(() =>
      expect(screen.getByText(/did not answer/i).textContent).toContain(
        "nothing is being estimated",
      ),
    );
  });
});

describe("waiting", () => {
  it("shows a hairline and announces itself while the request is out", async () => {
    let release: (value: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (release = resolve))),
    );
    const { container } = render(<Lookup />);
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(screen.getByLabelText(/paste a pons token address/i), {
      target: { value: ADDRESS },
    });
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
    await waitFor(() => expect(container.querySelector(".hairline-pulse")).toBeTruthy());
    expect(container.querySelector("[aria-live='polite']")?.getAttribute("aria-busy")).toBe("true");
    release(new Response(JSON.stringify(ok), { status: 200 }));
    await waitFor(() => expect(container.querySelector(".hairline-pulse")).toBeNull());
  });
});
