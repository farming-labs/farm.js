"use client";
import { useState } from "react";

export function PackageButton({ label }: { label: string }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button type="button" data-testid="package-button" onClick={() => setPressed(true)}>
      {pressed ? "package pressed" : label}
    </button>
  );
}
