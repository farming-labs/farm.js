import { betterAuth } from "@farm.js/better-auth";
import { defineConfig } from "@farm.js/core/config";
import { vue } from "@farm.js/vue";
import { auth } from "./src/lib/auth.ts";

export default defineConfig({
  renderer: vue(),
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
