import { defineConfig } from "@farm.js/core";
import { pwa } from "@farm.js/pwa";

export default defineConfig({
  images: { provider: "none" },
  plugins: [
    pwa({
      offline: "/offline",
      update: "prompt",
      cache: {
        staticRoutes: true,
        images: "swr",
      },
    }),
  ],
});
