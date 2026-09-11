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

export const metadata: Metadata = {
  metadataBase: new URL("https://ledge.tools"),
  title: "LEDGE — The Pons Number",
  description:
    "The Pons Number: the share of Pons launches that graduate, measured hourly from the factory contract, published with its denominator.",
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
