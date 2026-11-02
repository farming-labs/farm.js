import { createApiClients } from "@farm.js/core/api/client";
import { apiRoutes, type APIRouter } from "./api.generated";

export const { api, apiClient } = createApiClients<APIRouter>({ routes: apiRoutes });
