import { defineConfig } from "@farm.js/core";
import { react } from "@farm.js/react";

const compilerEnabled = process.env.FARM_REACT_COMPILER !== "false";

export default defineConfig({
  env: {
    public: {
      FARM_REACT_COMPILER_ENABLED: () => compilerEnabled,
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
