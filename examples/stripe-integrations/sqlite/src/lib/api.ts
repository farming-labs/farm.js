import { createIntegrations } from "@farmjs/core/client";
import type { AppIntegrations } from "./integrations";

export const { api, apiClient } = createIntegrations<AppIntegrations>();
