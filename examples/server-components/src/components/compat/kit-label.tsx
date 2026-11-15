"use client";
import { useSharedKitLabel } from "../../lib/kit-shared";

export function KitLabel() {
  const { label, click } = useSharedKitLabel();
  return (
    <button type="button" data-testid="kit-label" onClick={click}>
      {label}
    </button>
  );
}
