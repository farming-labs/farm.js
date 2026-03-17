import { createIntegrationClient } from "@farmjs/core/client";
import { supabaseClient } from "@farmjs/integrations/supabase/client";

export const api = createIntegrationClient({
  integrations: {
    supabase: supabaseClient,
  },
});
