import { defineConfig } from "@farm.js/core";
import { betterAuth } from "@farm.js/better-auth";
import { auth } from "./src/lib/auth.ts";

export default defineConfig({
  srcDir: "src",
  theme: {
    default: "dark",
  },
  // Docs are powered by the @farming-labs/farmjs framework. Farm auto-detects
  // the installed adapter and reads docs.config.ts (docs.json is kept as a
  // language-agnostic fallback/manifest); content lives in src/app/docs.
  docs: {
    enabled: true,
  },
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
