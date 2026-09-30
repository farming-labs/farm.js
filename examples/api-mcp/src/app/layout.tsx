import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farm API MCP Demo",
  description: "Turn an explicit allowlist of typed Farm API routes into MCP tools.",
};

export default function RootLayout({ children }: LayoutProps) {
  return <main className="shell">{children}</main>;
}
