"use client";
// The build for client code. Rendering KitQuote here means the server build was not used.
import { createElement as h, useState } from "react";

export { KitProvider, KitValue } from "./provider.js";

export function KitQuote({ topic }) {
  return h("p", { "data-testid": "kit-quote" }, `kit quote about ${topic}, client fallback`);
}

export function kitGreeting() {
  throw new Error("@farm-fixtures/rsc-kit: kitGreeting runs only in server components");
}

// A hook only the build for client code has, as libraries split them.
export function useKitLabel() {
  const [clicks, setClicks] = useState(0);
  return { label: `kit hook clicks: ${clicks}`, click: () => setClicks(clicks + 1) };
}
