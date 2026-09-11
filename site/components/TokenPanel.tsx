"use client";

/* The row-opened panel (REVAMP.md 1.1, "the depth the owner has asked for
   three times"). A reader clicks a row on /live, /graduated or /graveyard and
   gets this token's own facts without losing their sort, their filters, or
   their page -- but the panel is a convenience on top of `/t/{address}`, never
   a replacement for it: that page stays the real URL, it is what the unfurl
   card and the Telegram bot render, and it is what people paste into group
   chats, so the panel always carries a plain link to it.

   CONTENT COMES FROM THE SAME PLACE Lookup.tsx ALREADY RENDERS FROM: fetchToken
   and splitLookupText, both from lib/api.ts. Nothing here reformats a figure,
   recomputes a rate, or writes a sentence the API did not write -- that is
   what keeps this panel, the lookup, the /t page and the bot from ever saying
   three different things about one token. The only thing owned here is the
   ORDER the API's own sentences are placed in, because the order a panel opens
   to is not the order text.ts writes them in: distinct first-block buyers
   first (the reading that costs real money to fake), then the fill against
   this launch's own threshold, then buys/sells/quote with their window, then
   the cohort with its n, then the link out. */

import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from "react";
import { fetchToken, normaliseLookupInput, splitLookupText, type LookupResult } from "../lib/api";
import "../app/panel.css";

/** Holds every token this panel has already fetched, for the life of the
    page. A reopen of the same token -- paging back to a row already seen, or
    the browser's own Back/Forward stepping through `?token=` -- reads this
    instead of asking the API again. Module scope rather than component state:
    the panel unmounts when it closes, and the point is to survive that. */
const resultCache = new Map<string, LookupResult>();

/** Test-only escape hatch: the cache is intentionally module-scoped so a
    reopened token survives the panel unmounting, which also means it survives
    between test cases in the same file unless cleared. Not used by the
    running site. */
export function __clearTokenPanelCacheForTests(): void {
  resultCache.clear();
}

function shortAddress(address: string): string {
  return `${address.slice(0, 10)}…${address.slice(-6)}`;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type LoadState = { status: "loading" } | { status: "done"; result: LookupResult };

function useTokenLookup(token: string): LoadState {
  const [state, setState] = useState<LoadState>(() => {
    const cached = resultCache.get(token);
    return cached ? { status: "done", result: cached } : { status: "loading" };
  });

  useEffect(() => {
    const cached = resultCache.get(token);
    if (cached) {
      setState({ status: "done", result: cached });
      return;
    }
    setState({ status: "loading" });
    let live = true;
    const controller = new AbortController();
    void fetchToken(token, fetch, controller.signal).then((result) => {
      if (!live) return;
      resultCache.set(token, result);
      setState({ status: "done", result });
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [token]);

  return state;
}

/* Distinct buyers in the launch's own block, buys/sells/quote, and first
   buy/last activity -- worker/src/text.ts `activitySentences` writes these
   three lines in that order whenever the response carries an activity block,
   and none at all otherwise (a different silence than a zero -- see
   lib/api.ts `splitLookupText`). Named by index here only to place them in
   the order this panel opens to; the sentences themselves are untouched. */
function PanelFacts({ result }: { result: LookupResult }): ReactElement {
  if (result.kind === "error") {
    return <p className="lookup-line-plain">{result.message}</p>;
  }

  const body = result.body;
  const lines = splitLookupText(body);
  const address = normaliseLookupInput(body.address) ?? body.address;
  const [activityBuysSells, activityFirstLast, activityBuyers] = lines.activity;

  return (
    <div className="panel-facts">
      {result.kind === "partial" ? <p className="lookup-line-plain">{result.message}</p> : null}
      {lines.notice ? <p className="lookup-line-plain">{lines.notice}</p> : null}

      {activityBuyers ? <p className="panel-lede mono">{activityBuyers}</p> : null}

      {lines.fill ? <p className="note">{lines.fill}</p> : null}

      {activityBuysSells ? <p className="note note--fine">{activityBuysSells}</p> : null}
      {activityFirstLast ? <p className="note note--fine">{activityFirstLast}</p> : null}

      {lines.cohort.map((sentence) => (
        <p className="note" key={sentence}>
          {sentence}
        </p>
      ))}

      {lines.staleNote ? <p className="note note--fine is-stale">{lines.staleNote}</p> : null}

      <p className="panel-foot mono">
        <a href={`/t/${address}`}>Open the full page for {lines.identity ?? address}</a>
      </p>
    </div>
  );
}

export function TokenPanel({
  token,
  onClose,
  returnFocusTo,
}: {
  token: string;
  onClose: () => void;
  returnFocusTo: HTMLElement | null;
}): ReactElement {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const state = useTokenLookup(token);
  const heading = useMemo(() => shortAddress(token), [token]);

  /* Focus moves into the panel on open, is trapped inside it while it is
     open, and returns to the row that opened it on close (or to whatever had
     focus before, when the panel was opened by the URL rather than a click --
     `returnFocusTo` is then null). */
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const target = returnFocusTo && document.contains(returnFocusTo) ? returnFocusTo : previouslyFocused;
      target?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  return (
    <div
      className="panel-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="panel" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panelRef}>
        <div className="panel-head">
          <p className="panel-title mono" id={titleId}>
            {heading}
          </p>
          <button type="button" className="panel-close" onClick={onClose} ref={closeRef}>
            Close
          </button>
        </div>
        <div className="panel-body" aria-live="polite" aria-busy={state.status === "loading"}>
          {state.status === "loading" ? (
            <>
              <span className="vh">Looking up.</span>
              <div className="hairline-pulse" />
            </>
          ) : (
            <PanelFacts result={state.result} />
          )}
        </div>
      </div>
    </div>
  );
}
