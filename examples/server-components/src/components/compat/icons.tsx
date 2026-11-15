"use client";
import { Moon, Sun } from "lucide-react";
import { useState } from "react";

export function IconToggle() {
  const [dark, setDark] = useState(false);
  return (
    <button type="button" data-testid="icon-toggle" onClick={() => setDark((value) => !value)}>
      {dark ? <Moon aria-label="moon" /> : <Sun aria-label="sun" />}
    </button>
  );
}
