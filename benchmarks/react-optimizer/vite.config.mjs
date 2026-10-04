import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import million from "million/compiler";
import { defineConfig } from "vite";
import { createFarmRendererPlugin } from "../../packages/farm-react/dist/vite.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const variant = process.env.REACT_OPTIMIZER_VARIANT || "react";
const artifactDir = path.join(root, ".bench-artifacts");
const isMillion =
  variant === "million-auto" || variant === "million-for" || variant === "million-for-block";

function millionProofPlugin() {
  let compiled = false;
  let manualPrimitives = false;
  let reactListPortal = false;
  let transformed = "";
  return {
    name: "benchmark:million-proof",
    enforce: "pre",
    transform(code, id) {
      if (!id.replace(/\\/g, "/").match(/\/bench(?:-million(?:-block)?)?\.tsx$/)) return null;
      transformed = code;
      compiled ||= code.includes("compiledBlock") && code.includes("million/react");
      reactListPortal ||=
        variant === "million-auto" && code.includes("rows.map(") && code.includes("portals:");
      manualPrimitives ||=
        (variant === "million-for" && code.includes('import { For } from "million/react"')) ||
        (variant === "million-for-block" &&
          code.includes('import { block, For } from "million/react"') &&
          code.includes("const MillionRow = block(RowView)"));
      return null;
    },
    closeBundle() {
      fs.mkdirSync(artifactDir, { recursive: true });
      fs.writeFileSync(
        path.join(artifactDir, `${variant}-proof.json`),
        `${JSON.stringify(
          {
            compiled,
            manualPrimitives,
            reactListPortal,
            transformedBytes: Buffer.byteLength(transformed),
          },
          null,
          2,
        )}\n`,
      );
      fs.writeFileSync(path.join(artifactDir, `${variant}-transform.js`), transformed);
      if (variant === "million-auto" && !compiled) {
        throw new Error("Million automatic mode did not compile the workload.");
      }
      if ((variant === "million-for" || variant === "million-for-block") && !manualPrimitives) {
        throw new Error(`Million's ${variant} workload did not retain its manual primitives.`);
      }
    },
  };
}

const optimizerPlugins = [];
if (variant === "farm") {
  optimizerPlugins.push(
    ...createFarmRendererPlugin({
      rendererOptions: {
        experimental: {
          compiler: {
            onUnsupported: "error",
            reportFile: ".bench-artifacts/farm-report.json",
          },
        },
      },
    }),
  );
} else if (isMillion) {
  optimizerPlugins.push(
    million.vite({
      auto: variant === "million-auto" ? { threshold: 0 } : false,
      log: false,
      telemetry: false,
    }),
    millionProofPlugin(),
  );
}

export default defineConfig({
  plugins: [...optimizerPlugins, react()],
  resolve: {
    alias: {
      "@farm.js/react/compiler-runtime": path.resolve(
        root,
        "../../packages/farm-react/dist/compiler-runtime.mjs",
      ),
      "virtual:bench-component": path.resolve(
        root,
        variant === "million-for"
          ? "src/bench-million.tsx"
          : variant === "million-for-block"
            ? "src/bench-million-block.tsx"
            : "src/bench.tsx",
      ),
    },
  },
  build: {
    emptyOutDir: true,
    minify: "esbuild",
    outDir: path.join(root, ".bench-dist", variant),
    sourcemap: false,
  },
});
