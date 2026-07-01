import type { LayoutProps } from "@farmjs/core";
import geistMonoUrl from "../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2?url";
import geistPixelUrl from "../../node_modules/geist/dist/fonts/geist-pixel/GeistPixel-Square.woff2?url";
import geistSansUrl from "../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2?url";
import "./globals.css";

export const metadata = {
  title: "farmjs.dev - React framework for integrated apps",
  description:
    "Farm.js is an easy and fast React framework that blends app foundations and external services into one flow so teams can ship products faster.",
};

const fontFaceCss = `
@font-face {
  font-family: "Geist Sans";
  src: url("${geistSansUrl}") format("woff2");
  font-display: block;
  font-style: normal;
  font-weight: 100 900;
}

@font-face {
  font-family: "Geist Mono";
  src: url("${geistMonoUrl}") format("woff2");
  font-display: block;
  font-style: normal;
  font-weight: 100 900;
}

@font-face {
  font-family: "Geist Pixel Square";
  src: url("${geistPixelUrl}") format("woff2");
  font-display: block;
  font-style: normal;
  font-weight: 500;
}

:root {
  --font-geist-sans: "Geist Sans";
  --font-geist-mono: "Geist Mono";
  --font-geist-pixel: "Geist Pixel Square";
}
`;

export default function RootLayout({ children }: LayoutProps) {
  return (
    <>
      <link rel="preload" href={geistSansUrl} as="font" type="font/woff2" crossOrigin="anonymous" />
      <link rel="preload" href={geistMonoUrl} as="font" type="font/woff2" crossOrigin="anonymous" />
      <link
        rel="preload"
        href={geistPixelUrl}
        as="font"
        type="font/woff2"
        crossOrigin="anonymous"
      />
      <style dangerouslySetInnerHTML={{ __html: fontFaceCss }} />
      <main className="min-h-screen bg-black font-mono text-white">{children}</main>
    </>
  );
}
