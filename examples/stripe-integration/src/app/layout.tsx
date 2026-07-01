import "./globals.css";
import type { LayoutProps } from "@farmjs/core";

export default function Layout({ children }: LayoutProps) {
  return <div data-example="stripe">{children}</div>;
}
