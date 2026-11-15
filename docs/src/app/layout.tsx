import type { LayoutProps, Metadata } from "@farm.js/core";
import { defineLayoutFonts, localFont } from "@farm.js/core/font";
import { Databuddy } from "@databuddy/sdk/react";
import { SITE_URL } from "../lib/site";
import "./globals.css";

// metadataBase makes canonical, Open Graph, and Twitter URLs absolute on every
// page. Open Graph merges shallowly and has no fallback to the page title, so
// pages set their own og title and description rather than inheriting one here.
export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Farm.js - The framework for the web and agents",
  description:
    "Farm.js is the full-stack framework for the web and agents: apps are agent-ready by default and run any agent runtime you bring. Built on Vite and Nitro.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
  },
  openGraph: {
    siteName: "Farm.js",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
} satisfies Metadata;

const geistSans = localFont({
  src: "../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  family: "Geist Sans",
  weight: "100 900",
  display: "block",
  variable: "--font-geist-sans",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

const geistMono = localFont({
  src: "../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  family: "Geist Mono",
  weight: "100 900",
  display: "block",
  variable: "--font-geist-mono",
  fallback: ["ui-monospace", "monospace"],
});

const geistPixel = localFont({
  src: "../../node_modules/geist/dist/fonts/geist-pixel/GeistPixel-Square.woff2",
  family: "Geist Pixel Square",
  weight: 500,
  variable: "--font-geist-pixel",
  fallback: ["monospace"],
  // Only feature headings below the fold use it; preloading it pushed Geist Sans
  // out of the two-font preload budget.
  preload: false,
});

export const fonts = defineLayoutFonts({
  body: geistSans,
  code: geistMono,
});

export default function RootLayout({ children }: LayoutProps) {
  return (
    <>
      <div
        className={`${geistSans.variable} ${geistMono.variable} ${geistPixel.variable} ${geistSans.className} min-h-screen bg-black text-white`}
      >
        {children}
      </div>
      <Databuddy clientId="0af7dbbd-628a-44c9-8814-df4138a061b0" trackWebVitals={true} />
    </>
  );
}
