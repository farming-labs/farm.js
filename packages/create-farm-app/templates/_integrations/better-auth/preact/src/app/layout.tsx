import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "FARMJS Preact Better Auth Starter",
  description: "Better Auth with FARMJS and Preact",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
  },
};

export default function RootLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
