"use client";
import { useTheme } from "./theme";

// A consumer of the layout's provider that waits until it scrolls into view. Islands mode hydrates
// it in the layout's tree, so it reads the provider like any other client component there.
export const island = "visible";

export function ThemeLater() {
  return <p data-testid="theme-later">{`Later theme: ${useTheme()}`}</p>;
}
