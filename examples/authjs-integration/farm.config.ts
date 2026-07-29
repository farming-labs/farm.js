import { defineConfig } from "@farm.js/core";
import { authjs } from "@farm.js/integrations/authjs";
import { nextAuth } from "./auth.ts";

export default defineConfig({
  experimental: {
    serverComponents: true,
  },
  integrations: {
    auth: authjs({
      instance: nextAuth,
      log(event) {
        console.log("[authjs-example]", event.phase, event.route?.path || "none");
      },
    }),
  },
});
