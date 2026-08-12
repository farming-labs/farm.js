import { betterAuth } from "@farm.js/better-auth";
import { defineConfig } from "@farm.js/core/config";
import { solid } from "@farm.js/solid";
import { auth } from "./src/lib/auth.ts";

export default defineConfig({
  renderer: solid(),
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
