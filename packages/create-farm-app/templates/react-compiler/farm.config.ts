import { defineConfig } from "@farm.js/core";
import { react } from "@farm.js/react";

const compilerEnabled = process.env.FARM_REACT_COMPILER !== "false";

export default defineConfig({
  vite: {
    define: {
      __FARM_REACT_COMPILER_ENABLED__: JSON.stringify(compilerEnabled),
    },
  },
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
