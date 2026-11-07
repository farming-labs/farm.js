import { Link } from "@farm.js/core/client";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

// A package provider in a layout, around the pages: it keeps its state across navigations.
export default function ThemedLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="light" enableSystem={false}>
      <nav>
        <Link href="/compat/layout-provider/one">Themed one</Link>{" "}
        <Link href="/compat/layout-provider/two">Themed two</Link>
      </nav>
      <p>Server text in the themed layout.</p>
      {children}
    </ThemeProvider>
  );
}
