import { betterAuth } from "@farm.js/better-auth";
import { defineConfig } from "@farm.js/core/config";
import { preact } from "@farm.js/preact";
import { auth } from "./src/lib/auth.ts";

export default defineConfig({
  renderer: preact(),
  theme: {
    default: "dark",
  },
  integrations: {
    auth: betterAuth({ instance: auth }),
  },
  deploy: {
    target: "vercel",
  },
});
