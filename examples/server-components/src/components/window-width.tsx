"use client";
import { useEffect, useState } from "react";

export function WindowWidth() {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => setWidth(window.innerWidth), []);
  return <p data-testid="window-width">{width === null ? "Measuring" : `Width ${width}`}</p>;
}
