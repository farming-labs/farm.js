import { defineConfig } from "@farm.js/core";

export default defineConfig({
  srcDir: "src",
  deploy: {
    target: "vercel",
  },
});
