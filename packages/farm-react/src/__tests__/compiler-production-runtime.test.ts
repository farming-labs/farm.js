// @vitest-environment node

import { fileURLToPath } from "node:url";
import { build, normalizePath } from "vite";
import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const root = normalizePath(fileURLToPath(new URL("../../", import.meta.url)));
const runtime = normalizePath(fileURLToPath(new URL("../compiler-runtime.tsx", import.meta.url)));
const entry = `${root}refresh-payload.tsx`;

async function bundle(hot: boolean) {
  const result = await compileReactModule(
    `import { useState } from "react";
     export function Counter() {
       const [count, setCount] = useState(0);
       return <button onClick={() => setCount(count + 1)}>{count}</button>;
     }`,
    entry,
    normalizeReactCompilerOptions(true),
  );
  expect(result.compiled).toEqual(["Counter"]);
  expect(result.diagnostics).toEqual([]);
  const output = await build({
    root,
    configFile: false,
    logLevel: "silent",
    define: { "import.meta.hot": hot ? "true" : "false" },
    css: { postcss: { plugins: [] } },
    resolve: { alias: { "@farm.js/react/compiler-runtime": runtime } },
    plugins: [
      {
        name: "refresh-payload",
        resolveId: (id) => (id === entry ? entry : null),
        load: (id) => (id === entry ? result.code : null),
      },
    ],
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: entry,
        preserveEntrySignatures: "strict",
        external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
      },
    },
  });
  return [output]
    .flat()
    .flatMap((item) => item.output)
    .filter((item) => item.type === "chunk")
    .map((item) => item.code)
    .join("\n");
}

describe("compiler refresh payload", () => {
  it("removes the refresh registry and compatibility checks from production", async () => {
    const code = await bundle(false);
    expect(code).toContain("FarmCompiledComponent");
    expect(code).not.toContain("@farm.js/react/compiler-hmr-registry");
    expect(code).not.toContain("stateSignature");
    expect(code).not.toContain("runtimeSignature");
  });

  it("retains refresh identity and compatibility checks when hot updates are enabled", async () => {
    const code = await bundle(true);
    expect(code).toContain("@farm.js/react/compiler-hmr-registry");
    expect(code).toContain("stateSignature");
    expect(code).toContain("runtimeSignature");
    expect(code).toContain("refresh-payload.tsx#Counter");
  });
});
