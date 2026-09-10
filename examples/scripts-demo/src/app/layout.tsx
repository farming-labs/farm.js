import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farm Scripts Demo",
  description: "Typed and lifecycle-aware third-party browser scripts",
};

export default function RootLayout({ children }: LayoutProps) {
  return <main className="shell">{children}</main>;
}
