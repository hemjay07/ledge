import type { ReactElement, ReactNode } from "react";
import { Age } from "./Age";
import { Figure } from "./Figure";
import { OneInFigure } from "./OneInFigure";
import { Stat } from "./Stat";
import {
  SAMPLE_CLAUSE,
  SAMPLE_METHOD_SHORT,
  formatCount,
  formatDayLong,
  formatDurationLong,
  formatOneIn,
} from "../lib/format";
import { LEAD } from "../lib/lead";
import type { Sample, WindowData } from "../lib/schema";
import { posterSentence, secondarySentence } from "../lib/summary";

export interface FoldProps {
  w: WindowData;
  crawledAt: string;
  staleAfterSeconds: number;
  /** the one sentence a cold visitor needs; the card page carries none */
  dek?: ReactNode;
  /** the second figure's sentence names its counts on the sheet, not the card */
  secondaryCounts?: boolean;
  /** the finding the second figure exists for, set directly beneath it */
  finding?: ReactNode;
  /** the fold's fine print: what the window's counts do not yet contain */
  fine?: ReactNode;
  /** a dated sample, set above the poster figure. It carries its own n and
      its own measurement date, and it renders only when it carries the
      denominator its share was taken over. */
  sample?: (Sample & { sampled: number }) | null;
}

/* The fold: kicker, poster figure, the denominator hanging beneath it as a
   caption, the hair rule, and the second figure with its gloss. The two pages
   that carry a fold render this, so they cannot drift apart.

   Both figures are always here, over the same n, the same window and the same
   measurement, each with its own fine print. LEAD (lib/lead.ts) chooses which
   of the two is the poster and which is the second block — nothing else.

   Beneath the pair sit two optional slots: the finding the second figure
   exists for, and the fold's fine print. The card page passes neither, so the
   two folds still cannot drift apart on anything they share. */
export function Fold({
  w,
  crawledAt,
  staleAfterSeconds,
  dek = null,
  secondaryCounts = false,
  finding = null,
  fine = null,
  sample = null,
}: FoldProps): ReactElement {
  const exFast = w.excludingFast;
  const cutoffWords = formatDurationLong(exFast.cutoffSeconds);
  const leadsRaw = LEAD === "raw";

  /* the caption counts the poster's numerator: each block carries the
     graduations its own figure was computed from */
  const posterGraduations = leadsRaw ? w.graduations : exFast.graduations;

  return (
    <>
      <div className="fold">
        <h1 className="kicker">The Pons Number</h1>
        {/* The sample stands above the poster figure: it is a dated reading
            over its own n, not a live window, and the line beneath it says so
            before the eye reaches the 24-hour number. The share goes through
            Stat like every other rate, so it cannot be printed without its
            denominator and it falls to "not enough data (n=…)" under the same
            gate. */}
        {sample ? (
          <>
            <p className="sample-line">
              <Stat
                className="mono"
                name="raised-nothing"
                value={sample.share ?? null}
                n={sample.sampled}
                window={`sample ${sample.measuredAt}`}
                updatedAt={sample.measuredAt}
              />{" "}
              {SAMPLE_CLAUSE}
            </p>
            <p className="note note--fine sample-fine">
              <span className="mono">
                {formatCount(sample.count)} of {formatCount(sample.sampled)}
              </span>{" "}
              sampled · {formatDayLong(sample.measuredAt)} · {SAMPLE_METHOD_SHORT}
            </p>
          </>
        ) : null}
        <div className="figure-block">
          {leadsRaw ? (
            <Figure
              name="pons-number"
              value={w.rate}
              n={w.launches}
              window="24h"
              updatedAt={crawledAt}
              insufficient={w.insufficient}
              accessibleText={posterSentence(w, cutoffWords, crawledAt)}
            />
          ) : (
            <OneInFigure
              name="excluding-fast"
              oneIn={exFast.oneIn}
              value={exFast.rate}
              n={w.launches}
              window="24h"
              updatedAt={crawledAt}
              insufficient={exFast.insufficient}
              accessibleText={posterSentence(w, cutoffWords, crawledAt)}
            />
          )}
        </div>
        <p className="caption">
          of <b>{formatCount(w.launches)}</b> launches in the last 24&nbsp;hours graduated
          {leadsRaw ? null : <>, excluding launches that graduated inside {cutoffWords}</>}{" "}
          <span className="den">
            · <span className="mono">{formatCount(posterGraduations)}</span> graduations ·{" "}
            <Age crawledAt={crawledAt} staleAfterSeconds={staleAfterSeconds} />
          </span>
        </p>
        {dek}
      </div>

      <div className="rule-hair fold-rule" />
      <div className="second">
        {leadsRaw ? (
          <>
            <Figure
              name="excluding-fast"
              variant="secondary"
              value={exFast.rate}
              n={w.launches}
              window="24h"
              updatedAt={crawledAt}
              insufficient={exFast.insufficient}
              accessibleText={secondarySentence(w, cutoffWords, secondaryCounts)}
            />
            <p className="gloss">
              excluding launches that graduated inside {cutoffWords}
              {exFast.oneIn === null ? null : (
                <>
                  {" "}
                  · <b className="mono">{formatOneIn(exFast.oneIn)}</b>
                </>
              )}{" "}
              ·{" "}
              <span className="mono">
                {formatCount(exFast.graduations)} of {formatCount(w.launches)}
              </span>
            </p>
          </>
        ) : (
          <>
            <Figure
              name="pons-number"
              variant="secondary"
              value={w.rate}
              n={w.launches}
              window="24h"
              updatedAt={crawledAt}
              insufficient={w.insufficient}
              accessibleText={secondarySentence(w, cutoffWords, secondaryCounts)}
            />
            <p className="gloss">
              counting every graduation ·{" "}
              <span className="mono">
                {formatCount(w.graduations)} of {formatCount(w.launches)}
              </span>
            </p>
          </>
        )}
      </div>
      {finding ? <p className="finding">{finding}</p> : null}
      {fine ? <p className="note note--fine fold-fine">{fine}</p> : null}
    </>
  );
}
