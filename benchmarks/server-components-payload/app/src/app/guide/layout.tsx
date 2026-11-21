import type { ReactNode } from "react";
import { ThemeProvider, ThemeToggle } from "../../components/theme";

// The blog's posts under a client provider, as an app with a theme or auth provider around its
// pages: the layout hydrates as one root, and each post is rebuilt from a server tree in it.
export default function GuideLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ThemeToggle />
      <main>{children}</main>
    </ThemeProvider>
  );
}
