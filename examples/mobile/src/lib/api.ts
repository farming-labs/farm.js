// `@farm.js/core/api/client`, not `@farm.js/core/client`: native screens import this module too,
// and Metro resolves that entry to its React Native build, which calls mobile.server.
import { createApiClients } from "@farm.js/core/api/client";
import { apiRoutes, type APIRouter } from "./api.generated";

export const { api, apiClient } = createApiClients<APIRouter>({ routes: apiRoutes });
