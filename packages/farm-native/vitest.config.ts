import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The element tests render with react-dom/server, which must match React's version exactly. This
// package's own React has no react-dom, so the tests use core's matching pair.
const fromCore = createRequire(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../farm/package.json"),
);
const reactDir = path.dirname(fromCore.resolve("react/package.json"));
const reactDomDir = path.dirname(fromCore.resolve("react-dom/package.json"));

export default defineConfig({
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: [
      { find: /^react$/, replacement: path.join(reactDir, "index.js") },
      { find: /^react\/(.*)$/, replacement: `${reactDir}/$1` },
      { find: /^react-dom\/(.*)$/, replacement: `${reactDomDir}/$1` },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
