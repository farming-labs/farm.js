import { integrationsClient } from "@farmjs/core/client";
import type { AppIntegrations } from "./integrations";

export const apiClient = integrationsClient<AppIntegrations>();
