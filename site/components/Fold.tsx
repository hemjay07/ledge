import type { ReactElement, ReactNode } from "react";
import { Age } from "./Age";
import { Figure } from "./Figure";
import { OneInFigure } from "./OneInFigure";
import { formatCount, formatDurationLong, formatOneIn } from "../lib/format";
import { LEAD } from "../lib/lead";
import type { WindowData } from "../lib/schema";
import { posterSentence, secondarySentence } from "../lib/summary";

export interface FoldProps {
  w: WindowData;
  crawledAt: string;
  staleAfterSeconds: number;
  /** the one sentence a cold visitor needs; the card page carries none */
  dek?: ReactNode;
  /** the second figure's sentence names its counts on the sheet, not the card */
  secondaryCounts?: boolean;
}

/* The fold: kicker, poster figure, the denominator hanging beneath it as a
   caption, the hair rule, and the second figure with its gloss. The two pages
   that carry a fold render this, so they cannot drift apart.

   Both figures are always here, over the same n, the same window and the same
   measurement, each with its own fine print. LEAD (lib/lead.ts) chooses which
   of the two is the poster and which is the second block — nothing else. */
export function Fold({
  w,
  crawledAt,
  staleAfterSeconds,
  dek = null,
  secondaryCounts = false,
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
    </>
  );
}
