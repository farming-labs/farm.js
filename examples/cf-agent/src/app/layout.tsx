import type { LayoutProps } from "@farm.js/core";
import "./globals.css";

export const metadata = {
  title: "Farm + Cloudflare Agents",
  description: "A persistent Cloudflare Agent running beside a Farm application.",
};

export default function Layout({ children }: LayoutProps) {
  return children;
}
