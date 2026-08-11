import type { Metadata } from "@farm.js/core";
import type { ComponentChildren } from "preact";
import "./globals.css";
import "./preact.css";

export const metadata: Metadata = {
  title: "FARMJS Preact App",
  description: "A framework for product-integrated apps",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
  },
};

export default function RootLayout({ children }: { children?: ComponentChildren }) {
  return <>{children}</>;
}
