import { defineConfig } from "@farm.js/core";
import { react } from "@farm.js/react";

export default defineConfig({
  renderer: react({
    experimental: {
      compiler: true,
    },
  }),
  theme: {
    default: "dark",
  },
  deploy: {
    target: "node",
  },
});
