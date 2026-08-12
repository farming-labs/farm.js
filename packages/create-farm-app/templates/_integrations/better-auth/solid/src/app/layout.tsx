import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "FARMJS Solid Better Auth Starter",
  description: "Better Auth with FARMJS and Solid",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
  },
};

export default function RootLayout(props: LayoutProps) {
  return <>{props.children}</>;
}
