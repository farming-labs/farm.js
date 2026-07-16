import type { LayoutProps } from "@farmjs/core";
import "./globals.css";

export default function Layout({ children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <title>Farm + Eve</title>
      </head>
      <body>{children}</body>
    </html>
  );
}
