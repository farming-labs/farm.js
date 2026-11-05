import type { LayoutProps } from "@farm.js/core";

export default function Layout({ children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <title>Farm agents</title>
      </head>
      <body>{children}</body>
    </html>
  );
}
