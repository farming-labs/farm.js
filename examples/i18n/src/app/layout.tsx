import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farm.js i18n",
  description: "A complete Farm.js internationalization example.",
};

export default function RootLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
