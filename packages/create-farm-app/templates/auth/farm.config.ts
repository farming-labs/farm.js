import { defineConfig } from "@farm.js/core";

export default defineConfig({
  auth: true,
  experimental: {
    serverComponents: true,
  },
  deploy: {
    target: "vercel",
  },
});
