import { defineFarmConfig } from "@farmjs/core";
import { authjs } from "@farmjs/integrations/authjs";
import { nextAuth } from "./auth.ts";

export default defineFarmConfig({
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
