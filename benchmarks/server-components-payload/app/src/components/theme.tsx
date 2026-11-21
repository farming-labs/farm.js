"use client";
import { createContext, useContext, useState, type ReactNode } from "react";

const Theme = createContext<{ dark: boolean; toggle(): void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(false);
  return (
    <Theme.Provider value={{ dark, toggle: () => setDark((value) => !value) }}>
      <div data-theme={dark ? "dark" : "light"}>{children}</div>
    </Theme.Provider>
  );
}

export function ThemeToggle() {
  const theme = useContext(Theme);
  return (
    <button type="button" data-theme-toggle onClick={theme?.toggle}>
      {theme?.dark ? "Light" : "Dark"}
    </button>
  );
}
