"use client";
import { useState } from "react";

interface TypedPropsProps {
  updated: Date;
  tags: Set<string>;
  stock: Map<string, number>;
  id: bigint;
  missing?: string;
  ratio: number;
  limit: number;
  sign: number;
  bytes: Uint8Array;
}

// Receives values JSON cannot hold, and checks each arrives as its own type.
export function TypedProps(props: TypedPropsProps) {
  const [clicks, setClicks] = useState(0);
  const checks = [
    props.updated instanceof Date ? props.updated.toISOString() : "not a Date",
    props.tags instanceof Set ? [...props.tags].join(",") : "not a Set",
    props.stock instanceof Map ? `sku-1=${props.stock.get("sku-1")}` : "not a Map",
    typeof props.id === "bigint" ? `${props.id}n` : "not a BigInt",
    props.missing === undefined ? "undefined" : "defined",
    Number.isNaN(props.ratio) ? "NaN" : "a number",
    String(props.limit),
    Object.is(props.sign, -0) ? "-0" : "0",
    props.bytes instanceof Uint8Array ? [...props.bytes].join(".") : "not bytes",
  ];
  return (
    <section>
      <p data-testid="typed">{checks.join(" | ")}</p>
      <button type="button" onClick={() => setClicks(clicks + 1)}>{`Typed clicks: ${clicks}`}</button>
    </section>
  );
}
