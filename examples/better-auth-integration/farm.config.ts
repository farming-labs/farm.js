import { defineConfig } from "@farmjs/core";
import { betterAuth } from "@farmjs/integrations/better-auth";
import { auth } from "./src/lib/auth.ts";

export default defineConfig({
  experimental: {
    serverComponents: true,
  },
  vite: {
    server: {
      port: 3000,
      strictPort: true,
    },
  },
  integrations: {
    auth: betterAuth({
      instance: auth,
      log(event) {
        console.log("[better-auth-example]", event.phase, event.route?.path || "none");
      },
    }),
  },
});
