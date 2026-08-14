import { defineConfig } from "@farm.js/core";
import { react } from "@farm.js/react";

const compilerEnabled = process.env.FARM_REACT_COMPILER !== "false";

export default defineConfig({
  renderer: react({
    experimental: {
      compiler: compilerEnabled,
    },
  }),
  theme: {
    default: "dark",
  },
  deploy: {
    target: "node",
  },
});
