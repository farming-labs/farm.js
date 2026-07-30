import { defineConfig } from "@farm.js/core";
import { betterAuth } from "@farm.js/better-auth";
import { auth } from "./src/lib/auth.ts";

export default defineConfig({
  experimental: {
    serverComponents: true,
  },
  integrations: {
    auth: betterAuth({
      instance: auth,
      log(event) {
        if (process.env.NODE_ENV !== "production") {
          console.log("[better-auth]", event.phase, event.route?.path ?? "request");
        }
      },
    }),
  },
  deploy: {
    target: "vercel",
  },
});
