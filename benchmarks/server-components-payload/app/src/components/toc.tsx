"use client";
import { useState } from "react";

export function Toc({ headings }: { headings: { id: string; text: string }[] }) {
  const [active, setActive] = useState(headings[0]?.id);
  return (
    <ol>
      {headings.map((heading) => (
        <li key={heading.id} data-active={heading.id === active ? "" : undefined}>
          <a href={`#${heading.id}`} onClick={() => setActive(heading.id)}>
            {heading.text}
          </a>
        </li>
      ))}
    </ol>
  );
}
