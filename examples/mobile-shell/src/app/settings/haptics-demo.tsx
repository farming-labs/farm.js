"use client";

import { useState } from "react";
import { native, type HapticStyle } from "../../lib/native";

const STYLES: HapticStyle[] = ["light", "medium", "heavy"];

export function HapticsDemo() {
  const [status, setStatus] = useState("Not called yet.");

  async function impact(style: HapticStyle) {
    const started = performance.now();
    try {
      const result = await native.haptics.impact(style);
      const ms = (performance.now() - started).toFixed(1);
      setStatus(`${style} via ${result.via} in ${ms} ms`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <>
      <div className="actions">
        {STYLES.map((style) => (
          <button key={style} className="button" type="button" onClick={() => impact(style)}>
            {style}
          </button>
        ))}
      </div>
      <p className="meta" data-testid="haptics-status">
        {status}
      </p>
    </>
  );
}
