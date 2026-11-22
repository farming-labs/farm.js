import { createApiClients } from "@farm.js/core/api/client";
import { apiRoutes, type APIRouter } from "./api.generated";

// `apiClient` calls the routes over HTTP from the browser; `api` is the server-side caller.
export const { apiClient } = createApiClients<APIRouter>({ routes: apiRoutes });
