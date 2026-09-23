import { createApiClients } from "@farm.js/core/client";
import { apiRoutes, type APIRouter } from "../../lib/api.generated";

export const { api, apiClient } = createApiClients<APIRouter>({ routes: apiRoutes });
