import type { LayoutProps } from "@farm.js/core";
import { defineLayoutFonts, localFont } from "@farm.js/core/font";
import { Databuddy } from "@databuddy/sdk/react";
import "./globals.css";

export const metadata = {
  title: "farmjs.dev - React framework for integrated apps",
  description:
    "Farm.js is an easy and fast React framework that blends app foundations and external services into one flow so teams can ship products faster.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
  },
};

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
      <main
        className={`${geistSans.variable} ${geistMono.variable} ${geistPixel.variable} ${geistMono.className} min-h-screen bg-black text-white`}
      >
        {children}
      </main>
      <Databuddy clientId="0af7dbbd-628a-44c9-8814-df4138a061b0" trackWebVitals={true} />
    </>
  );
}
