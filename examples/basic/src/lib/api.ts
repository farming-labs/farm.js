import { createApiClients } from "@farm.js/core/client";
import { apiRoutes, type APIRouter } from "./api.generated";

export const { api, apiClient } = createApiClients<APIRouter>({
  routes: apiRoutes,
  timeoutMs: 30_000,
});
