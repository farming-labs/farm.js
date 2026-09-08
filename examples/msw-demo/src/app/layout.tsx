import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farm MSW Demo",
  description: "Shared development mocks for Farm server and browser requests",
};

export default function RootLayout({ children }: LayoutProps) {
  return <main className="shell">{children}</main>;
}
