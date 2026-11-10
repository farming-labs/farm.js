"use client";
import { useEffect, useState } from "react";

// Throws when it renders in a browser, so its island fails to hydrate.
export function HydrationCrash() {
  // The effect makes this island hydrate at load instead of waiting for a click.
  useEffect(() => {}, []);
  if (typeof window !== "undefined") throw new Error("battle: island crashed on hydration");
  return <p data-testid="crash">crash server html</p>;
}

export function Clicker({ name }: { name: string }) {
  const [count, setCount] = useState(0);
  return (
    <button type="button" data-testid={`clicker-${name}`} onClick={() => setCount(count + 1)}>
      {`${name}: ${count}`}
    </button>
  );
}
