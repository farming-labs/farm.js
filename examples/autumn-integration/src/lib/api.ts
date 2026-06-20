import { integrationClients } from "@farmjs/core/client";
import type { AppIntegrations } from "./integrations";

export const { api, apiClient } = integrationClients<AppIntegrations>();

