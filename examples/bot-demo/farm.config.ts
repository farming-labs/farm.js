import { bot } from "@farm.js/bot";
import { defineConfig } from "@farm.js/core";
import { botProvider } from "./src/bot";

export default defineConfig({
  images: { provider: "none" },
  plugins: [
    bot({
      provider: botProvider(),
      // Production builds need the hostnames the forms are served from.
      hostnames: process.env.BOT_HOSTNAMES?.split(",") ?? ["localhost"],
    }),
  ],
  // A strict policy: the plugin adds the provider's sources to it.
  security: {
    csp: {
      nonce: true,
      directives: {
        "default-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:"],
      },
    },
  },
});
