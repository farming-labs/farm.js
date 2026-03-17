import { createIntegrationClient } from "@farmjs/core/client";
import { supabaseClient } from "@farmjs/integrations/supabase/client";
import { localDemoClient } from "./integrations/local-demo/client.ts";

export const api = createIntegrationClient({
  integrations: {
    supabase: supabaseClient,
    localDemo: localDemoClient,
  },
});
