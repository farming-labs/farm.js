import type { LayoutProps, Metadata } from "@farm.js/core";
import { catalogSeed, SERVER_ONLY_LAYOUT_TOKEN } from "../lib/server-data";
import { CounterIsland } from "../components/counter-island";
import { DismissIsland } from "../components/dismiss-island";

export const metadata: Metadata = {
  title: "Isolated hydration example",
  description: "Server layout with isolated client islands",
};

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body data-catalog-count={catalogSeed.length} data-server-token={SERVER_ONLY_LAYOUT_TOKEN}>
        <header>
          <nav>
            <a href="/">home</a> <a href="/about">about</a>
          </nav>
          <CounterIsland start={0} />
          <DismissIsland label="dismiss me" />
        </header>
        {children}
      </body>
    </html>
  );
}
