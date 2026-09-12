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
import { fetchToken, normaliseLookupInput, type LookupResult } from "../lib/api";
import {
  fillPercent,
  formatAge,
  formatCount,
  formatDuration,
  pairLabel,
  pairQuantity,
  rateText,
  taxPercent,
} from "../lib/format";
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

/* The facts, from the structured body -- not the bot's sentences.

   Until 2026-09-12 this panel printed the sentences text.ts writes for the
   bot, which read like a report ("Launches configured this way, all time:
   687 of 31,177 graduated, 2.20%. Excluding..."). A row was clicked to see
   whether anything is real here; that is four figures, in the order the
   token page gives them: buyers in the launch block, fill, activity, and
   what launches like it did. The sentences are untouched and still live on
   the full page, folded. */
function PanelFacts({ result }: { result: LookupResult }): ReactElement {
  if (result.kind === "error") {
    return <p className="lookup-line-plain">{result.message}</p>;
  }

  const body = result.body;
  const address = normaliseLookupInput(body.address) ?? body.address;
  const { config, state, activity, cohort } = body;
  const pair = pairLabelOf(config.pairSymbol, config.pairClass);
  const tax = taxPercent(config.creatorTaxBps);

  const firstBlock = activity?.firstBlock ?? null;
  const fillPct =
    state.curveFilledWei !== null && state.graduationThresholdWei !== null
      ? fillPercent(state.curveFilledWei, state.graduationThresholdWei)
      : null;
  const filled =
    state.curveFilledWei !== null
      ? pairQuantity(state.curveFilledWei, config.pairDecimals, null).text
      : null;
  const threshold =
    state.graduationThresholdWei !== null
      ? pairQuantity(state.graduationThresholdWei, config.pairDecimals, config.pairSymbol).text
      : null;

  return (
    <div className="panel-facts">
      {result.kind === "partial" ? <p className="lookup-line-plain">{result.message}</p> : null}
      {body.notice ? <p className="lookup-line-plain">{body.notice}</p> : null}

      <p className="note note--fine mono">
        {pair} · {tax} ·{" "}
        {state.elapsedSeconds === null ? "launch not read" : `launched ${formatAge(state.elapsedSeconds)} ago`} ·{" "}
        {state.graduated
          ? `graduated${state.timeToGraduationSeconds === null ? "" : ` in ${formatDuration(state.timeToGraduationSeconds)}`}`
          : "on the curve"}
      </p>

      <div className="panel-fact">
        <span className="panel-fact-k">Buyers in the launch block</span>
        <span className="panel-fact-v mono">
          {firstBlock === null ? "not read" : formatCount(firstBlock.distinctBuyers)}
        </span>
      </div>

      <div className="panel-fact">
        <span className="panel-fact-k">Fill</span>
        <span className="panel-fact-v mono">
          {state.graduated
            ? "graduated"
            : filled !== null && threshold !== null
              ? `${filled} of ${threshold}${fillPct === null ? "" : ` · ${fillPct.toFixed(1)}%`}`
              : "not read"}
        </span>
      </div>

      {activity ? (
        <div className="panel-fact">
          <span className="panel-fact-k">Since launch</span>
          <span className="panel-fact-v mono">
            {formatCount(activity.buys)} buys · {formatCount(activity.sells)} sells
          </span>
        </div>
      ) : null}

      {cohort?.allTime ? (
        <div className="panel-fact">
          <span className="panel-fact-k">Launches like it that graduated</span>
          <span className="panel-fact-v mono">
            {rateText({
              rate: cohort.allTime.rate,
              n: cohort.allTime.launches,
              insufficient: cohort.allTime.insufficient,
            })}{" "}
            <span className="thin">of {formatCount(cohort.allTime.launches)}, all time</span>
          </span>
        </div>
      ) : null}

      <p className="panel-foot mono">
        <a href={`/t/${address}`}>Open the full page for {shortAddress(address)}</a>
      </p>
    </div>
  );
}

/** The pair in the reader's word: the symbol when known, else the class. */
function pairLabelOf(symbol: string | null, pairClass: string): string {
  return symbol ?? pairLabel(pairClass);
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
