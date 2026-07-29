import { defineConfig } from "@farm.js/core";
import { clerk } from "@farm.js/clerk";

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
    auth: clerk({
      protectedRoutes: ["/dashboard(.*)"],
      log(event) {
        console.log("[clerk-example]", event.phase, event.route?.path || "none");
      },
    }),
  },
});
