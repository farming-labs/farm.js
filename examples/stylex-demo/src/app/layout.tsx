import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farm StyleX Demo",
  description: "Static StyleX compilation with Farm",
};

export default function RootLayout({ children }: LayoutProps) {
  return children;
}
