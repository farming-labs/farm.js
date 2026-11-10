export {
  APIClientError,
  createApiClients,
  createAPIClient,
  createServerAPIClient,
} from "./api/client";
export type {
  ApiClients,
  APIClient,
  APIClientOptions,
  APIClientSystemError,
  APIClientWithoutIntegrationsOptions,
  RouteAPIClient,
  ServerAPIClient,
  ServerAPIClientOptions,
  ServerAPIClientWithoutIntegrationsOptions,
} from "./api/client";
// Integration client bindings (`api.get(...)`) without `@farm.js/core/client`, which also loads
// Farm's React client. Integration packages share these modules between the browser and their
// server entry, so a backend-only app (`renderer: false`) can load them without React.
export {
  api,
  endpoint,
  defineIntegrationAPI,
  defineIntegrationAPIOperation,
} from "./integration-api";
export type {
  FarmIntegrationAPI,
  FarmIntegrationAPIBodyFormat,
  FarmIntegrationAPIMethod,
  FarmIntegrationAPIOperation,
  FarmIntegrationAPIResponseFormat,
} from "./integration-api";
