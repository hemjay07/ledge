import type { ReactElement } from "react";
import { formatDuration, insufficientText } from "../lib/format";
import type { TtgHistogramBucket } from "../lib/schema";

/* The shape of the record: how long every graduation took, in doubling
   buckets, drawn as one figure.

   WHY THIS DRAWING EXISTS. Every other figure on this site is a number, and a
   number cannot show a shape. This distribution has two populations in it and
   a trough between them, and that is visible in one glance and invisible in
   any percentage. Measured 2026-09-10 over 2,474 graduations: 158 landed
   under two seconds, 96 in the bucket above it, and the broad hump peaked at
   285 in 160 to 320 seconds.

   WHY DOUBLING BUCKETS. Graduation times run from under a second to over four
   days. On an equal-width axis the whole record is one bar at the left and
   the drawing says nothing. The bucket edges are a DEFINITION and live in
   pipeline/stats.py as HISTOGRAM_EDGES, not here; moving one moves a
   published figure and takes a dated /method entry (CONSTRAINTS 9).

   WHAT IT DOES NOT SAY. It is a description of a population. It says how long
   graduations took. It does not say which of them were real, no bucket is a
   label, and nothing here is coloured to mean good or bad -- CONSTRAINTS 6
   binds every edge on this axis the way it binds the 5-minute mark. The
   reader draws the conclusion; drawing it for them would be the verdict
   CONSTRAINTS 1 forbids. */

const X0 = 40.5;
const W = 639;
const BASE_Y = 210;
const TOP_Y = 30;
const LABEL_Y = BASE_Y + 20;
const AXIS_CAPTION_Y = BASE_Y + 46;
const VIEWBOX_H = BASE_Y + 66;

/** The tick label under a bucket: its lower edge, which is where it starts. */
function edgeLabel(seconds: number): string {
  return seconds === 0 ? "0" : formatDuration(seconds);
}

/** The bucket's own range, said in full, for the row's accessible name. */
function rangeLabel(bucket: TtgHistogramBucket): string {
  const from = edgeLabel(bucket.fromSeconds);
  return bucket.toSeconds === null
    ? `${from} and slower`
    : `${from} to ${formatDuration(bucket.toSeconds)}`;
}

export function Shape({
  histogram,
  n,
  insufficient,
}: {
  histogram: TtgHistogramBucket[];
  n: number;
  insufficient: boolean;
}): ReactElement {
  /* Below the minimum the bars would be noise drawn at full height, which
     reads as a finding. The sample size is printed instead, in the same words
     every other under-sampled figure on the site uses. */
  if (insufficient || histogram.length === 0) {
    return <p className="note insufficient">{insufficientText(n)}</p>;
  }

  const tallest = Math.max(...histogram.map((b) => b.graduations));
  const slot = W / histogram.length;
  const gap = Math.min(6, slot * 0.18);
  const barW = slot - gap;

  return (
    <figure className="shape">
      <svg
        viewBox={`0 0 720 ${VIEWBOX_H}`}
        role="img"
        aria-label={`How long ${n.toLocaleString("en-US")} graduations took, in doubling buckets from under two seconds to slower than ${formatDuration(
          histogram[histogram.length - 1]?.fromSeconds ?? 0,
        )}`}
      >
        <g>
          {histogram.map((bucket, i) => {
            /* Height is proportional to the raw count, from a zero baseline.
               A truncated baseline would exaggerate the shape, which on a
               drawing whose whole point is its shape would be a lie told with
               geometry rather than with a number. */
            const h = tallest === 0 ? 0 : ((BASE_Y - TOP_Y) * bucket.graduations) / tallest;
            const x = X0 + i * slot + gap / 2;
            return (
              <rect
                key={bucket.fromSeconds}
                x={x}
                y={BASE_Y - h}
                width={barW}
                height={h}
                className="shape-bar"
              >
                <title>
                  {`${rangeLabel(bucket)}: ${bucket.graduations.toLocaleString("en-US")} of ${n.toLocaleString("en-US")}`}
                </title>
              </rect>
            );
          })}
        </g>

        <line
          x1={X0 - 0.5}
          y1={BASE_Y + 0.5}
          x2={X0 + W + 0.5}
          y2={BASE_Y + 0.5}
          className="eng-line"
          strokeWidth="1"
        />

        {/* Every other bucket's lower edge, so the labels clear each other at
            390px where the type is stepped up. */}
        <g className="eng-text" textAnchor="middle">
          {histogram.map((bucket, i) =>
            i % 2 === 0 ? (
              <text key={bucket.fromSeconds} x={X0 + i * slot + slot / 2} y={LABEL_Y}>
                {edgeLabel(bucket.fromSeconds)}
              </text>
            ) : null,
          )}
        </g>

        <text x={X0 + W / 2} y={AXIS_CAPTION_Y} className="eng-text" textAnchor="middle">
          Time to graduation · each bucket about double the last
        </text>
      </svg>
    </figure>
  );
}
