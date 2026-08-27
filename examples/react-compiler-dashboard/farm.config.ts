import { defineConfig } from "@farm.js/core";
import { react } from "@farm.js/react";

const compilerEnabled = process.env.FARM_REACT_COMPILER !== "false";
const reactivity = process.env.FARM_REACTIVITY === "static" ? "static" : "hybrid";

export default defineConfig({
  renderer: react({
    experimental: {
      compiler: compilerEnabled ? { reactivity, report: true } : false,
    },
  }),
  theme: {
    default: "dark",
  },
  deploy: {
    target: "node",
  },
});
