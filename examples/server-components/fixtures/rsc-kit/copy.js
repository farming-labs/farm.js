"use client";
import { createElement as h, useState } from "react";

export function KitCopy() {
  const [copies, setCopies] = useState(0);
  return h(
    "button",
    { type: "button", "data-testid": "kit-copy", onClick: () => setCopies(copies + 1) },
    `kit copies: ${copies}`,
  );
}
