import { defineFarmConfig } from "@farmjs/core";
import { supabase } from "@farmjs/integrations/supabase";
import { localDemo } from "./src/lib/integrations/local-demo/index.ts";

export default defineFarmConfig({
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
    auth: supabase({
      callbackUrl: `${process.env.APP_BASE_URL || "http://localhost:3000"}/auth/callback`,
      protectedRoutes: ["/dashboard(.*)"],
      pages: {
        signIn: "/sign-in",
        signUp: "/sign-up",
      },
      log(event) {
        console.log("[supabase-example]", event.phase, event.route?.path || "none");
      },
    }),
    localDemo: localDemo({
      greeting: "App-local integration registered from farm.config.ts.",
      log(event) {
        console.log("[local-demo]", event.phase, event.route?.path || "none");
      },
    }),
  },
});
