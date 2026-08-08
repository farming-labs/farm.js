import { defineConfig } from "@farm.js/core";

export default defineConfig({
  auth: true,
  theme: {
    default: "dark",
  },
  experimental: {
    serverComponents: true,
  },
  deploy: {
    target: "vercel",
  },
});
