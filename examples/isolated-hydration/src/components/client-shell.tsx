"use client";
import type { ReactNode } from "react";
import { useState } from "react";

export const island = "load";

export function ClientShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section data-testid="shell" data-open={open ? "yes" : "no"}>
      <button type="button" data-testid="shell-toggle" onClick={() => setOpen(!open)}>
        {open ? "shell open" : "shell closed"}
      </button>
      <div data-testid="shell-children">{children}</div>
    </section>
  );
}
