"use client";
import { useState } from "react";
import type { NavSection } from "../data";

export function Sidebar({ tree }: { tree: NavSection[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <nav aria-label="Docs">
      {tree.map((section) => (
        <div key={section.title}>
          <button
            type="button"
            onClick={() => setOpen({ ...open, [section.title]: !open[section.title] })}
          >
            {section.title}
          </button>
          {open[section.title] === false ? null : (
            <ul>
              {section.items.map((item) => (
                <li key={item.href}>
                  <a href={item.href} title={item.description}>
                    {item.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </nav>
  );
}
