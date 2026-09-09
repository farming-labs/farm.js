import { betterAuth } from "@farm.js/better-auth";
import { defineConfig } from "@farm.js/core/config";
import { svelte } from "@farm.js/svelte";
import { auth } from "./src/lib/auth.ts";

export default defineConfig({
  renderer: svelte(),
  theme: {
    default: "dark",
  },
  integrations: {
    auth: betterAuth({ instance: auth }),
  },
  migrations: {
    commands: [{ name: "Better Auth schema", command: "pnpm auth:migrate" }],
  },
  deploy: {
    target: "vercel",
  },
});
