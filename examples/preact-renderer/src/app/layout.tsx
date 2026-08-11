import type { Metadata } from "@farm.js/core";
import type { ComponentChildren } from "preact";
import "./globals.css";

export const metadata: Metadata = {
  title: "FARMJS Preact renderer",
  description: "Preact SSR, streaming, hydration, and colocated FARMJS server primitives",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
  },
};

export default function RootLayout({ children }: { children?: ComponentChildren }) {
  return <>{children}</>;
}
