"use client";
import { useState } from "react";
import type { NavSection } from "../data";

export function MobileNav({ tree }: { tree: NavSection[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        Menu
      </button>
      {open ? (
        <ul>
          {tree.flatMap((section) =>
            section.items.map((item) => (
              <li key={item.href}>
                <a href={item.href}>{item.title}</a>
              </li>
            )),
          )}
        </ul>
      ) : null}
    </div>
  );
}
