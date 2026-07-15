import { defineConfig } from "@farmjs/core";

export default defineConfig({
  srcDir: "src",
  deploy: {
    target: "vercel",
  },
});
