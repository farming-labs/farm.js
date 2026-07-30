import { defineConfig } from "@farm.js/core";
import { clerk } from "@farm.js/clerk";

export default defineConfig({
  experimental: {
    serverComponents: true,
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
