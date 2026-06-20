import { integrationsClient, integrationsServer } from "@farmjs/core/client";
import { supabaseClient } from "@farmjs/integrations/supabase/client";
import type { InferIntegrationAPIFromRoutes } from "@farmjs/core";
import type { localDemoRoutes } from "./integrations/local-demo/index.ts";

const supabaseApi = {
  login: {
    get: supabaseClient.oauth,
    post: supabaseClient.login,
  },
  signup: {
    post: supabaseClient.signup,
  },
  logout: {
    post: supabaseClient.logout,
  },
  session: {
    get: supabaseClient.session,
  },
} as const;

type SupabaseIntegrationSources = {
  auth: typeof supabaseApi;
  localDemo: InferIntegrationAPIFromRoutes<typeof localDemoRoutes>;
};

export const api = integrationsServer<SupabaseIntegrationSources>();
export const apiClient = integrationsClient<SupabaseIntegrationSources>();
