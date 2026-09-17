import type { Metadata, Viewport } from "next";
import { Anton, IBM_Plex_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import "./shell.css";
import { TopBar } from "../components/TopBar";

const display = Anton({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--ledge-font-display",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--ledge-font-mono",
});

const body = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
  variable: "--ledge-font-body",
});

const HOME_DESCRIPTION =
  "Counts every pons launch on Robinhood Chain: how many graduate, how fast, what happens after. Every figure with the number it was counted from.";

export const metadata: Metadata = {
  metadataBase: new URL("https://ledge.tools"),
  title: "LEDGE — The Pons Number",
  description: HOME_DESCRIPTION,
  /* The homepage's preview is the live graduation card from the Worker,
     stamped with its measurement time; pages set their own in lib/social.ts. */
  openGraph: {
    type: "website",
    url: "https://ledge.tools/",
    siteName: "LEDGE",
    title: "LEDGE — The Pons Number",
    description: HOME_DESCRIPTION,
    images: [{ url: "/og/figure/graduation.png", width: 1200, height: 630, alt: "The share of pons launches that graduated, with its n and measurement time." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "LEDGE — The Pons Number",
    description: HOME_DESCRIPTION,
    images: ["/og/figure/graduation.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    shortcut: "/favicon.ico",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EFEAE0" },
    { media: "(prefers-color-scheme: dark)", color: "#121110" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} ${body.variable}`}>
      <body>
        {/* The shell, mounted once. Until 2026-09-11 there was none: each of
            eight pages rendered its own copy of the navigation inline, so the
            only action on the site sat halfway down the home page and every
            destination was a full reload from a standing start. */}
        <TopBar />
        {children}
      </body>
    </html>
  );
}
