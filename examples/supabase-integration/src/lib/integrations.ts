import { supabase } from "@farm.js/supabase";
import { localDemo } from "./integrations/local-demo/index.ts";

export const appIntegrations = {
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
} as const;

export type AppIntegrations = typeof appIntegrations;
