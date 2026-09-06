/* Types for scripts/og.mjs, so the card's text tree can be read by a test
   that `tsc --noEmit` also checks. */

export interface CardNode {
  type: string;
  props: { style?: Record<string, unknown>; children?: unknown };
}

/** The card as a satori element tree. Building it renders nothing. */
export function cardTree(data: unknown, nowMs?: number): CardNode;

/** Every string the tree would set, in order. */
export function cardText(node: unknown): string[];

export function readNumberFile(path: string): unknown;
