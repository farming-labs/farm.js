import type { ReactNode } from "react";
import { ThemeProvider, ThemeToggle } from "../../components/theme";
import { layoutNote } from "../../server/layout-note";

export default function ContextLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ThemeToggle />
      <p>{layoutNote()}</p>
      {children}
    </ThemeProvider>
  );
}
