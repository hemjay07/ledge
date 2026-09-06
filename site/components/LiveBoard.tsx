"use client";

import { useEffect, useState, type ReactElement } from "react";
import { LedgerEntry } from "./LedgerEntry";
import { fetchLive, stripAddresses, type LiveResult } from "../lib/api";
import { formatAge, formatCount, pairLabel, taxLabel } from "../lib/format";

/* The last launches, as the index has them.

   Anonymous by construction: the Worker selects no token column, and every
   cell is put through stripAddresses on the way to the DOM anyway, because a
   rule that lives only on the other side of a network call is not a rule. The
   board carries no rate and no cohort, so there is no denominator to print and
   nothing here for the recompute gate to cover. */

const REFRESH_MS = 15_000;

interface Row {
  age: string;
  pair: string;
  tax: string;
  state: string;
}

function rowsOf(result: LiveResult): Row[] {
  if (result.kind !== "live") return [];
  return result.body.rows.map((row) => ({
    age: stripAddresses(formatAge(row.ageSeconds)),
    pair: stripAddresses(pairLabel(row.pairClass)),
    tax: stripAddresses(row.taxBucket === null ? "tax not read" : taxLabel(row.taxBucket)),
    state: row.graduated ? "graduated" : "on the curve",
  }));
}

export function LiveBoard({ folio }: { folio: string }): ReactElement {
  const [result, setResult] = useState<LiveResult | null>(null);
  const [observedMs, setObservedMs] = useState<number | null>(null);
  const [ageSeconds, setAgeSeconds] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const load = async () => {
      const next = await fetchLive(fetch, controller.signal);
      if (!live) return;
      setResult(next);
      setObservedMs(next.kind === "live" ? Date.parse(next.body.observedAt) : null);
    };
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      live = false;
      controller.abort();
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (observedMs === null || Number.isNaN(observedMs)) {
      setAgeSeconds(null);
      return;
    }
    const tick = () => setAgeSeconds(Math.max(0, Math.round((Date.now() - observedMs) / 1000)));
    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, [observedMs]);

  const rows = result === null ? [] : rowsOf(result);
  const count = result?.kind === "live" ? result.body.count : null;
  const stale = result?.kind === "live" && result.body.live.stale;

  const note = (
    <>
      {count === null ? null : <> · {formatCount(count)} launches</>}
      {ageSeconds === null ? null : (
        <>
          {" "}
          · updated <span className={stale ? "mono is-stale" : "mono"}>{formatAge(ageSeconds)}</span>{" "}
          ago
        </>
      )}
    </>
  );

  return (
    <LedgerEntry folio={folio} id="h-live" heading="Last launches" headingNote={note}>
      <div className="scroller" tabIndex={0} role="group" aria-label="The last launches indexed">
        <table>
          <caption>No address and no ticker: the board is the population, not a list.</caption>
          <thead>
            <tr>
              <th scope="col">Age</th>
              <th scope="col">Pair token</th>
              <th scope="col">Creator tax</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${i}-${row.age}-${row.pair}-${row.tax}`}>
                <th scope="row">{row.age}</th>
                <td className="fig n">{row.pair}</td>
                <td className="fig n">{row.tax}</td>
                <td className="thin">{row.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result === null ? <div className="hairline-pulse" /> : null}
      {result !== null && result.kind === "error" ? (
        <p className="lookup-line-plain">{result.message}</p>
      ) : null}
      {result !== null && result.kind === "live" && rows.length === 0 ? (
        <p className="note note--fine">No launches are indexed yet.</p>
      ) : null}
    </LedgerEntry>
  );
}
