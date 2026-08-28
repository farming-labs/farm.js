import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farm PWA Demo",
  description: "An installable and offline-aware Farm application",
  icons: {
    icon: "/farm-pwa.svg",
  },
};

export default function RootLayout({ children }: LayoutProps) {
  return <main className="shell">{children}</main>;
}
