import "./globals.css";
import type { LayoutProps } from "@farm.js/core";

export default function Layout({ children }: LayoutProps) {
  return <div data-example="workos">{children}</div>;
}
