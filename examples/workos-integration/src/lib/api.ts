import { integrationsClient, integrationsServer } from "@farmjs/core/client";
import type { AppIntegrations } from "./integrations";

export const api = integrationsServer<AppIntegrations>();
export const apiClient = integrationsClient<AppIntegrations>();
