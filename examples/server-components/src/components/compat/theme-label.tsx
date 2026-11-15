"use client";
import "client-only";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeName() {
  const { theme, setTheme } = useTheme();
  // next-themes knows the theme only in the browser: render it once mounted, as its README shows.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <button
      type="button"
      data-testid="next-theme"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {`next-theme: ${mounted ? theme : "unset"}`}
    </button>
  );
}
