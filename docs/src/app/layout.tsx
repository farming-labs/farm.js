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
  title: "farmjs.dev - Framework for integrated apps",
  description:
    "Farm.js is an easy and fast full-stack framework that blends app foundations and external services into one flow so teams can ship products faster.",
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
