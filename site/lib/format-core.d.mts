/* Types for lib/format-core.mjs. The module itself is plain JavaScript so that
   scripts/og.mjs can import it on bare node; these declarations are how the
   site's TypeScript sees it. Every call site is type-checked against this file
   by `tsc --noEmit`, and every function is exercised by tests/format.test.ts. */

/** A rate with the denominator it was computed over, as the pipeline writes it. */
export interface RateFact {
  rate: number | null | undefined;
  n: number;
  insufficient?: boolean;
}

export const INSUFFICIENT_BELOW: number;

export function decimalsFor(n: number): number;
export function insufficientText(n: number): string;
export function formatRate(rate: number, n: number, precision?: number): string;

export function isInsufficient(fact: RateFact): boolean;
export function rateText(fact: RateFact, precision?: number): string;
export function shareText(part: number, whole: number, precision?: number): string;

export function formatOneIn(oneIn: number): string;
export function formatCount(value: number): string;
export function formatDuration(seconds: number): string;
export function formatDurationLong(seconds: number): string;
export function formatAge(seconds: number): string;
export function formatStamp(iso: string): string;
export function formatUtcLong(iso: string): string;
export function formatUtcTime(iso: string): string;
