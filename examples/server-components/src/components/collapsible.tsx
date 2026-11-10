"use client";
import { useState, type ReactNode } from "react";

export function Collapsible({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {title}
      </button>
      {open ? <div data-testid="collapsible-body">{children}</div> : null}
    </section>
  );
}
