import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farm Partytown Demo",
  description: "Move opted-in third-party scripts off the main thread",
};

export default function RootLayout({ children }: LayoutProps) {
  return (
    <>
      <script type="text/partytown" src="/demo-analytics.js" />
      <main className="shell">{children}</main>
    </>
  );
}
