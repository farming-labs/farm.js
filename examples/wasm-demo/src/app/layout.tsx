import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farm WebAssembly Lab",
  description: "Real WebAssembly imports in the browser and browser workers",
};

export default function Layout({ children }: LayoutProps) {
  return children;
}
