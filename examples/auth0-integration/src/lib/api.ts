import { integrationsClient, integrationsServer } from "@farmjs/core/client";
import { auth0Client } from "@farmjs/integrations/auth0/client";

const auth0Api = {
  login: {
    get: auth0Client.login,
  },
  signup: {
    get: auth0Client.signup,
  },
  logout: {
    get: auth0Client.logout,
  },
  profile: {
    get: auth0Client.profile,
  },
} as const;

type Auth0IntegrationSources = {
  auth: typeof auth0Api;
};

export const api = integrationsServer<Auth0IntegrationSources>();
export const apiClient = integrationsClient<Auth0IntegrationSources>();
