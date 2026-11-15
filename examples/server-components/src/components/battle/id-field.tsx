"use client";
import { useEffect, useId, useState } from "react";

export function IdField({ label }: { label: string }) {
  const id = useId();
  const [value, setValue] = useState("");
  // The id React uses after hydration, which effects and later renders see.
  const [clientId, setClientId] = useState("");
  useEffect(() => setClientId(id), [id]);
  return (
    <p>
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} onChange={(event) => setValue(event.target.value)} />
      <output data-testid={`echo-${label}`}>{value}</output>
      <output data-testid={`id-${label}`}>{clientId}</output>
    </p>
  );
}
