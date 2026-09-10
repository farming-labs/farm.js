import { defineScript } from "@farm.js/scripts/client";

export interface RecordedEvent {
  event: "project_created";
  properties: { plan: "pro"; source: "dashboard" };
  recordedAt: string;
}

interface AnalyticsSDK {
  events: RecordedEvent[];
  track(event: RecordedEvent["event"], properties: RecordedEvent["properties"]): RecordedEvent;
}

interface SupportChatSDK {
  load(options: { visitor: string }): void;
  open(): string;
}

export const analytics = defineScript<AnalyticsSDK>({
  name: "demo-analytics",
  src: "/demo-analytics.js",
  global: "demoAnalytics",
  load: "after-hydration",
  consent: "analytics",
  timeout: "5s",
});

export const supportChat = defineScript<SupportChatSDK>({
  name: "support-chat",
  src: "/support-chat.js",
  global: "SupportChat",
  load: "manual",
  timeout: "5s",
  retries: 1,
});
