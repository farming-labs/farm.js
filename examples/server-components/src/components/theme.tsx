"use client";
import { createContext, useContext, useState, type ReactNode } from "react";

const ThemeContext = createContext<{ theme: string; toggle: () => void }>({
  theme: "none",
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState("light");
  return (
    <ThemeContext.Provider value={{ theme, toggle: () => setTheme(theme === "light" ? "dark" : "light") }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemeLabel() {
  return <p data-testid="theme-label">{`Theme: ${useTheme()}`}</p>;
}

export function useTheme(): string {
  return useContext(ThemeContext).theme;
}

export function ThemeToggle() {
  const { toggle } = useContext(ThemeContext);
  return (
    <button type="button" onClick={toggle}>
      Toggle theme
    </button>
  );
}
