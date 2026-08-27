import type { Metadata } from "@farm.js/core";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farm React compiler dashboard benchmark",
  description:
    "A production dashboard and standard 1,000-row benchmark for the Farm React compiler.",
};

export default function RootLayout({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
