"use client";

import { useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import {
  fetchToken,
  normaliseLookupInput,
  splitLookupText,
  type LookupResult,
} from "../lib/api";

/* One launch, looked up against the published cohorts.

   Every sentence below arrives from the API already written. This component
   places the lines in the register and does not compose one of its own: the
   only strings it owns are the field label and the word on the submit, and
   neither is a figure. A rate that the sample cannot support arrives as
   "not enough data (n=…)" and is printed exactly so, because there is no code
   path here from a null to a percentage — there is no formatting here at all. */

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; result: LookupResult };

export function Lookup(): ReactElement {
  const inputId = useId();
  const [value, setValue] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const pending = useRef<AbortController | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const typed = value.trim();
    if (typed === "") return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState({ status: "loading" });
    const result = await fetchToken(typed, fetch, controller.signal);
    if (controller.signal.aborted) return;
    setState({ status: "done", result });
  }

  return (
    <form className="lookup" onSubmit={onSubmit} noValidate>
      <label className="lookup-label" htmlFor={inputId}>
        Paste a Pons token address or ponsfamily.com launch URL
      </label>
      <div className="lookup-line">
        <input
          id={inputId}
          className="lookup-input mono"
          name="token"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="lookup-submit" type="submit">
          Look up
        </button>
      </div>

      <div className="lookup-out" aria-live="polite" aria-busy={state.status === "loading"}>
        {state.status === "loading" ? (
          <>
            <span className="vh">Looking up.</span>
            <div className="hairline-pulse" />
          </>
        ) : null}
        {state.status === "done" ? <Result result={state.result} typed={value} /> : null}
      </div>
    </form>
  );
}

function Result({ result, typed }: { result: LookupResult; typed: string }): ReactElement {
  if (result.kind === "error") {
    return <p className="lookup-line-plain">{result.message}</p>;
  }

  const body = result.body;
  const lines = splitLookupText(body);
  const address = normaliseLookupInput(body.address) ?? typed;

  return (
    <div className="lookup-entry">
      {lines.headline ? <p className="lookup-headline mono">{lines.headline}</p> : null}
      {lines.config ? <p className="lookup-config mono">{lines.config}</p> : null}

      {result.kind === "partial" ? (
        <p className="lookup-line-plain">{result.message}</p>
      ) : null}
      {lines.notice ? <p className="lookup-line-plain">{lines.notice}</p> : null}

      {lines.cohort.map((sentence) => (
        <p className="note" key={sentence}>
          {sentence}
        </p>
      ))}
      {lines.placement ? <p className="note">{lines.placement}</p> : null}
      {lines.fill ? <p className="note note--fine">{lines.fill}</p> : null}
      {/* This token's own indexed activity, in the API's own sentences: its
          buys and sells with the window they were counted over, its first buy
          and last activity, and the distinct buyers in its own launch block.
          Rendered verbatim so the lookup, the /t page and the Telegram bot
          cannot say three different things about one token. */}
      {lines.activity.map((sentence) => (
        <p className="note note--fine" key={sentence}>
          {sentence}
        </p>
      ))}
      {lines.staleNote ? <p className="note note--fine is-stale">{lines.staleNote}</p> : null}

      <p className="lookup-foot mono">
        <a href={`/t/${address}`}>{lines.identity ?? address}</a>
        {lines.stamp ? <span className="lookup-stamp"> {lines.stamp}</span> : null}
      </p>
    </div>
  );
}
