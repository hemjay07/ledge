import type { ReactElement } from "react";
import { formatDuration, insufficientText } from "../lib/format";

/* The engraved logarithmic scale: 1 second to 1 hour, over a 720x210 viewBox
   that scales to the sheet. Tick labels sit on two tiers so the legends stay
   apart at 390px, where the type is stepped up by the stylesheet. */

const X0 = 40.5;
const W = 639;
const T_MAX = 3600;
const LOG_MAX = Math.log10(T_MAX);

/* The baseline sits low enough that both percentile tiers clear each other at
   the mobile type size. At 390px the drawing renders about half its viewBox
   width, so the legends are set at roughly double their desktop size to stay
   legible (globals.css, max-width 40rem); at the old 44-unit tier separation
   the doubled numerals overlapped their own labels and their neighbours'. The
   geometry is derived from BASE_Y so the two stay in step. */
const BASE_Y = 216;
const MAJOR_LABEL_Y = BASE_Y + 40;
const MAJOR_LABEL_Y2 = BASE_Y + 60;
const AXIS_CAPTION_Y = BASE_Y + 82;
const VIEWBOX_H = BASE_Y + 106;
const NEEDLE_TIP_Y = BASE_Y + 16;

/* Four legend rows, each with sole occupancy, because at the mobile type size
   any two that share a row collide: the descriptive cutoff, then the longest
   observed time, then the two percentile tiers. The longest observed time is
   usually the rightmost mark and used to share tier A with p90. */
const CUT_LABEL_Y = 22;
const CUT_LINE_TOP = 32;
const MAX_LABEL_Y = 56;
const MAX_TICK_TOP = 64;

export function scaleX(seconds: number): number {
  const t = Math.min(Math.max(seconds, 1), T_MAX);
  return X0 + (W * Math.log10(t)) / LOG_MAX;
}

const MAJORS: { t: number; label: string; tier: 1 | 2 }[] = [
  { t: 1, label: "1 s", tier: 1 },
  { t: 10, label: "10 s", tier: 1 },
  { t: 60, label: "1 min", tier: 1 },
  { t: 300, label: "5 min", tier: 2 },
  { t: 600, label: "10 min", tier: 1 },
  { t: 3600, label: "1 h", tier: 1 },
];

const MINORS = [2, 5, 20, 30, 120, 1800];

interface Tier {
  num: number;
  label: number;
  top: number;
}

/* percentile legends alternate between two tiers so neighbouring marks never
   collide once the type steps up on a narrow sheet */
const TIER: Record<"A" | "B", Tier> = {
  A: { num: 92, label: 124, top: 132 },
  B: { num: 166, label: 198, top: 206 },
};

interface Mark {
  key: string;
  t: number;
  tier: Tier;
}

export interface ScaleProps {
  ttg: {
    n: number;
    insufficient: boolean;
    p50: number | null;
    p75: number | null;
    p90: number | null;
    p95: number | null;
    max: number | null;
  };
  cutoffSeconds: number;
}

export function Scale({ ttg, cutoffSeconds }: ScaleProps): ReactElement {
  if (ttg.insufficient || ttg.p50 === null) {
    return <p className="note insufficient">{insufficientText(ttg.n)}</p>;
  }

  const candidates: { key: string; t: number | null; tier: Tier }[] = [
    { key: "p50", t: ttg.p50, tier: TIER.A },
    { key: "p75", t: ttg.p75, tier: TIER.B },
    { key: "p90", t: ttg.p90, tier: TIER.A },
    { key: "p95", t: ttg.p95, tier: TIER.B },
  ];
  const marks: Mark[] = candidates.filter((m): m is Mark => m.t !== null);

  const cutX = scaleX(cutoffSeconds);
  const needleX = scaleX(ttg.p50);
  const maxSeconds = ttg.max;
  const maxX = maxSeconds === null ? null : scaleX(maxSeconds);
  const overflow = maxSeconds !== null && maxSeconds > T_MAX;

  const description =
    `Logarithmic scale of time to graduation from one second to one hour, over ${ttg.n} graduations. ` +
    marks.map((m) => `${m.key} ${formatDuration(m.t)}`).join(", ") +
    `. The descriptive ${formatDuration(cutoffSeconds)} cutoff is marked.` +
    (ttg.max === null ? "" : ` Longest observed ${formatDuration(ttg.max)}.`);

  return (
    <div className="scale">
      <svg viewBox={`0 0 720 ${VIEWBOX_H}`} role="img" aria-label={description}>
        <g shapeRendering="crispEdges">
          <line x1={X0 - 0.5} y1={BASE_Y + 0.5} x2={679.5} y2={BASE_Y + 0.5} className="eng-line" strokeWidth="1" />

          <g className="eng-tick" strokeWidth="1">
            {MINORS.map((t) => (
              <line key={t} x1={scaleX(t)} y1={BASE_Y} x2={scaleX(t)} y2={BASE_Y + 8} />
            ))}
          </g>

          <g className="eng-major" strokeWidth="1">
            {MAJORS.map((m) => (
              <line key={m.t} x1={scaleX(m.t)} y1={BASE_Y} x2={scaleX(m.t)} y2={BASE_Y + 15} />
            ))}
            <line x1={X0} y1={BASE_Y - 11} x2={X0} y2={BASE_Y} />
            <line x1={679.5} y1={BASE_Y - 11} x2={679.5} y2={BASE_Y} />
          </g>

          <line x1={cutX} y1={CUT_LINE_TOP} x2={cutX} y2={BASE_Y} className="eng-cut" strokeWidth="1" />

          <g className="eng-pct" strokeWidth="1.25">
            {marks.map((m) => (
              <line key={m.key} x1={scaleX(m.t)} y1={m.tier.top} x2={scaleX(m.t)} y2={BASE_Y} />
            ))}
          </g>

          {maxX === null ? null : (
            <line x1={maxX} y1={MAX_TICK_TOP} x2={maxX} y2={BASE_Y} className="eng-tick" strokeWidth="1" />
          )}
        </g>

        <text x={cutX} y={CUT_LABEL_Y} className="eng-text" textAnchor="middle">
          {formatDuration(cutoffSeconds)} cutoff
        </text>

        <g className="eng-num" textAnchor="middle">
          {marks.map((m) => (
            <text key={m.key} x={scaleX(m.t)} y={m.tier.num}>
              {formatDuration(m.t)}
            </text>
          ))}
        </g>
        <g className="eng-text eng-text--pct" textAnchor="middle">
          {marks.map((m) => (
            <text key={m.key} x={scaleX(m.t)} y={m.tier.label}>
              {m.key}
            </text>
          ))}
        </g>

        {maxX === null || maxSeconds === null ? null : (
          <text
            x={maxX}
            y={MAX_LABEL_Y}
            className="eng-text"
            textAnchor={overflow ? "end" : "middle"}
          >
            {overflow ? "max past 1 h" : `max ${formatDuration(maxSeconds)}`}
          </text>
        )}

        <g className="eng-text" textAnchor="middle">
          {MAJORS.map((m) => (
            <text key={m.t} x={scaleX(m.t)} y={m.tier === 1 ? MAJOR_LABEL_Y : MAJOR_LABEL_Y2}>
              {m.label}
            </text>
          ))}
        </g>
        <text x="40" y={AXIS_CAPTION_Y} className="eng-text" textAnchor="start">
          Logarithmic · seconds since launch
        </text>

        <g className="needle">
          <line x1={needleX} y1={MAX_LABEL_Y + 12} x2={needleX} y2={NEEDLE_TIP_Y} className="needle-body" />
          <polygon
            points={`${needleX},${NEEDLE_TIP_Y} ${needleX - 4.5},${NEEDLE_TIP_Y - 11} ${needleX + 4.5},${NEEDLE_TIP_Y - 11}`}
            className="needle-cap"
          />
          <circle cx={needleX} cy={MAX_LABEL_Y + 12} r="3" className="needle-cap" />
        </g>
      </svg>
    </div>
  );
}
