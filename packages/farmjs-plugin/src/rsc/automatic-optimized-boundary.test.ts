import { describe, expect, it } from "vitest";
import { transformAutomaticOptimizedBoundaries } from "./automatic-optimized-boundary.js";

describe("automatic optimized boundary transform", () => {
  it("wraps native boundary JSX calls without changing application imports", () => {
    const result = transformAutomaticOptimizedBoundaries(
      `import { jsx, jsxs } from "react/jsx-runtime";
export default function Page() {
  return jsxs("article", {
    className: "prose",
    children: [
      jsx("h1", { children: "Farm.js" }),
      jsxs("section", { children: [jsx("p", { children: "One" }), jsx("p", { children: "Two" })] })
    ]
  });
}`,
      "/app/src/app/page.tsx",
    );

    expect(result?.boundaryCount).toBe(2);
    expect(result?.code).toContain(
      'import { _optimizeBoundary as __farmOptimizeBoundary } from "@farm.js/plugin/rsc/optimized-boundary";',
    );
    expect(result?.code).toContain('__farmOptimizeBoundary(jsxs("article"');
    expect(result?.code).toContain('__farmOptimizeBoundary(jsxs("section"');
  });

  it("preserves client modules and generated framework entries", () => {
    const clientResult = transformAutomaticOptimizedBoundaries(
      `"use client";
import { jsx } from "react/jsx-runtime";
export default function ClientCard() { return jsx("section", { children: "Client" }); }`,
      "/app/src/components/client-card.tsx",
    );
    const generatedResult = transformAutomaticOptimizedBoundaries(
      `import { jsx } from "react/jsx-runtime";
export default function Entry() { return jsx("main", { children: "Entry" }); }`,
      "/app/.farm/rsc-entries/entry.rsc.tsx",
    );

    expect(clientResult).toBeNull();
    expect(generatedResult).toBeNull();
  });

  it("leaves modules without supported host boundaries unchanged", () => {
    const result = transformAutomaticOptimizedBoundaries(
      `import { jsx } from "react/jsx-runtime";
import { ProductCard } from "./product-card";
export default function Page() { return jsx(ProductCard, {}); }`,
      "/app/src/app/page.tsx",
    );

    expect(result).toBeNull();
  });
});
