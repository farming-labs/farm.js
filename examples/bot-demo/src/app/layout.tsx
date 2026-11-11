import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farm bot check demo",
  description: "A signup form protected by @farm.js/bot-check",
};

export default function RootLayout({ children }: LayoutProps) {
  return <main className="shell">{children}</main>;
}
