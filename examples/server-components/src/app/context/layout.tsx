import type { ReactNode } from "react";
import { ThemeProvider, ThemeToggle } from "../../components/theme";

export default function ContextLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ThemeToggle />
      {children}
    </ThemeProvider>
  );
}
