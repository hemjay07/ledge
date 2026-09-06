/* Rasterising the death card inside the Worker.

   The card itself is in card.ts, which imports nothing binary, so a test can
   read every string it would print without a font or a wasm module. This file
   is only the rasterising pass: resvg-wasm, initialised from a module imported
   at build time (the only form of WebAssembly a Worker accepts), with the two
   IBM Plex Mono faces handed to it as buffers. */

import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import regular from "../fonts/IBMPlexMono-Regular.ttf";
import semibold from "../fonts/IBMPlexMono-SemiBold.ttf";
import { CARD_WIDTH, MONO, cardSvg, cardTree } from "./card";
import type { TokenResponse } from "./schema";

export { CARD_WIDTH, CARD_HEIGHT, cardTree, cardSvg, collectText } from "./card";

let wasmReady: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  if (!wasmReady) wasmReady = initWasm(resvgWasm);
  return wasmReady;
}

export async function renderCard(
  body: Omit<TokenResponse, "text">,
  observedMaxSeconds: number | null,
): Promise<Uint8Array> {
  await ensureWasm();
  const resvg = new Resvg(cardSvg(cardTree(body, observedMaxSeconds)), {
    fitTo: { mode: "width", value: CARD_WIDTH },
    font: {
      fontBuffers: [new Uint8Array(regular), new Uint8Array(semibold)],
      defaultFontFamily: MONO,
      loadSystemFonts: false,
    },
  });
  return resvg.render().asPng();
}
