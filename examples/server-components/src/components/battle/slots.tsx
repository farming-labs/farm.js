"use client";
import { useState, type ReactNode } from "react";

export function Tabs({ header, panels }: { header: ReactNode; panels: ReactNode[] }) {
  const [active, setActive] = useState(0);
  return (
    <div>
      <div data-testid="tabs-header">{header}</div>
      {panels.map((_, index) => (
        <button key={index} type="button" onClick={() => setActive(index)}>
          {`Tab ${index + 1}`}
        </button>
      ))}
      <div data-testid="tabs-panel">{panels[active]}</div>
    </div>
  );
}
