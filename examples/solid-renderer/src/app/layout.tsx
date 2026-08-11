import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "FARMJS Solid renderer",
  description: "Solid SSR, hydration, and colocated FARMJS server primitives",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
  },
};

export default function RootLayout(props: LayoutProps) {
  return <>{props.children}</>;
}
