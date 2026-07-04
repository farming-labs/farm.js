import { createIntegrations } from "@farmjs/core/client";
import type { AppIntegrations } from "./integrations";

export const { apiClient } = createIntegrations<AppIntegrations>();
