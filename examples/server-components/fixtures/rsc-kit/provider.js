"use client";
import { createContext, createElement as h, useContext, useState } from "react";

const KitContext = createContext({ value: "none", next: () => {} });

export function KitProvider({ initial, children }) {
  const [value, setValue] = useState(initial);
  return h(KitContext.Provider, { value: { value, next: () => setValue(`${value}!`) } }, children);
}

export function KitValue() {
  const { value, next } = useContext(KitContext);
  return h("button", { type: "button", "data-testid": "kit-value", onClick: next }, `kit value: ${value}`);
}
