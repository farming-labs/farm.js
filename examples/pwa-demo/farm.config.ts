import { defineConfig } from "@farm.js/core";
import { pwaPlugin } from "@farm.js/pwa";

export default defineConfig({
  images: { provider: "none" },
  plugins: [
    pwaPlugin({
      offline: "/offline",
      update: "prompt",
      cache: {
        staticRoutes: true,
        images: "swr",
      },
    }),
  ],
});
