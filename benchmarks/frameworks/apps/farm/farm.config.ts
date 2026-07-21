import { defineConfig } from "@farmjs/core";

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
