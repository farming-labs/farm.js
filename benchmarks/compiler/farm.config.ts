import { defineConfig } from "@farm.js/core";
import { react } from "@farm.js/react";

// FARM_BENCH_COMPILER=1 builds the compiled variant. Everything else about the
// two builds is identical, so the runner attributes differences to the compiler.
const compiler = process.env.FARM_BENCH_COMPILER === "1";

export default defineConfig({
  srcDir: "src",
  preset: "node-server",
  renderer: react({
    experimental: {
      // report: true writes .farm/react-compiler.json so the runner can prove
      // the workload component actually compiled instead of falling back.
      compiler: compiler ? { report: true } : false,
    },
  }),
  routeRules: {
    "/": {
      render: "dynamic",
      headers: { "Cache-Control": "private, no-store" },
    },
  },
});
