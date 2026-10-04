import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farm.js + TanStack AI",
  description: "A streaming chat with server and client tools, on a Farm.js API route.",
};

export default function RootLayout({ children }: LayoutProps) {
  return <main className="shell">{children}</main>;
}
