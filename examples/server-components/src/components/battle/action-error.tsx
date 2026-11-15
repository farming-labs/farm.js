"use client";
import { useState } from "react";

export function ActionErrorButton({ fail }: { fail: () => Promise<string> }) {
  const [result, setResult] = useState("idle");
  return (
    <>
      <button
        type="button"
        onClick={() =>
          fail().then(
            (value) => setResult(`ok ${value}`),
            () => setResult("rejected"),
          )
        }
      >
        Run failing action
      </button>
      <output data-testid="action-error-result">{result}</output>
    </>
  );
}
