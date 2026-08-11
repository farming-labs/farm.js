import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";
import "./solid.css";

export const metadata: Metadata = {
  title: "FARMJS Solid App",
  description: "A framework for product-integrated apps",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
  },
};

export default function RootLayout(props: LayoutProps) {
  return <>{props.children}</>;
}
