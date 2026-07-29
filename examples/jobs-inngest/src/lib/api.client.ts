import { createIntegrations } from "@farm.js/core/client";
import type { AppIntegrations } from "./integrations";

export const { apiClient } = createIntegrations<AppIntegrations>();
