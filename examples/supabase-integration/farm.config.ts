import { defineFarmConfig } from "@farmjs/core";
import { supabase } from "@farmjs/integrations/supabase";

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
  },
});
