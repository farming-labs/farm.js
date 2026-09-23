import { defineForward } from "@farm.js/partytown/client";

export interface AnalyticsProperties {
  plan: "starter" | "pro";
  source: "dashboard";
}

export const track = defineForward<
  (event: "project_created", properties: AnalyticsProperties) => void
>("demoAnalytics.track");
