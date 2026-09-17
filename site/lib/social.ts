import type { Metadata } from "next";

/* The preview a page unfurls with on X, Telegram and the rest (2026-09-17).
   Until now only /number and the token pages had one; the homepage, the
   boards and /launch unfurled as bare links in the week the links went out.

   Pages about a figure carry that figure's own live card from the Worker
   (/og/figure/{name}.png, stamped with its measurement time and served
   fresh on every fetch), so the preview is never a stale number baked at
   build. Reference pages carry the brand image. */

const SITE = "https://ledge.tools";
const BRAND = "/ledge-og.png";

export type FigureCard = "graduation" | "firstbuy" | "graveyard";

export function social(path: string, title: string, description: string, figure?: FigureCard): Metadata {
  const image = figure ? `/og/figure/${figure}.png` : BRAND;
  const alt = figure
    ? `A LEDGE figure card: ${description}`
    : "LEDGE counts every pons launch on Robinhood Chain.";
  return {
    title: `${title} — LEDGE`,
    description,
    alternates: { canonical: `${SITE}${path}` },
    openGraph: {
      type: "website",
      url: `${SITE}${path}`,
      siteName: "LEDGE",
      title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
