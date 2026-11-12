"use client";
import { createElement as h, useState } from "react";

export function WidgetCounter({ label }) {
  const [count, setCount] = useState(0);
  return h(
    "button",
    { type: "button", "data-testid": "widget-counter", onClick: () => setCount(count + 1) },
    `${label}: ${count}`,
  );
}
