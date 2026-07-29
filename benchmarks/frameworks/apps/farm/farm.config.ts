import { defineConfig } from "@farm.js/core";

export default defineConfig({
  srcDir: "src",
  preset: "node-server",
  routeRules: {
    "/": {
      render: "dynamic",
      headers: { "Cache-Control": "private, no-store" },
    },
  },
});
