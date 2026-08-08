import { defineConfig } from "@farm.js/core";

export default defineConfig({
  theme: {
    default: "dark",
  },
  deploy: {
    target: "vercel",
  },
});
