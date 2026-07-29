import { betterAuth as farmBetterAuth } from "@farm.js/better-auth";
import {
  polar,
  type PolarBillingUsageProperties,
  type PolarWebhookEvent,
} from "@farm.js/polar";
import { auth } from "./auth.ts";
import { resolveOrganizationBillingOwner } from "./organization-server.ts";
import { polarPlans, polarProducts } from "./polar-catalog.ts";

const polarAccessToken = process.env.POLAR_ACCESS_TOKEN;

if (!polarAccessToken) {
  throw new Error(
    "Polar example requires POLAR_ACCESS_TOKEN. Add it to examples/polar-integration/.env.local.",
  );
}

export const appIntegrations = {
  auth: farmBetterAuth({
    instance: auth,
    log(event: { phase: string; route?: { path?: string } }) {
      console.log("[polar-example:better-auth]", event.phase, event.route?.path || "none");
    },
  }),
  billing: polar({
    accessToken: polarAccessToken,
    server: (process.env.POLAR_SERVER as "sandbox" | "production" | undefined) ?? "sandbox",
    appBaseUrl: process.env.APP_BASE_URL,
    webhooks: process.env.POLAR_WEBHOOK_SECRET
      ? {
          secret: process.env.POLAR_WEBHOOK_SECRET,
          async onEvent(event: PolarWebhookEvent) {
            console.log("[polar-example:webhook]", event.type, event.id);
          },
        }
      : undefined,
    billing: {
      resolveOwner: resolveOrganizationBillingOwner,
      plans: polarPlans,
      products: polarProducts,
      meters: process.env.POLAR_TOKENS_METER_ID
        ? {
            tokensMonthly: {
              aggregation: "sum",
              ingestion: "raw",
              eventName: process.env.POLAR_TOKENS_EVENT_NAME ?? "ai_usage",
              unit: "tokens",
              meterId: process.env.POLAR_TOKENS_METER_ID,
              quantityMetadataKey: "tokens",
              guard: {
                softLimit: "plan_limit",
                hardOverageByPlan: {
                  pro: 2_000_000,
                },
              },
            },
          }
        : undefined,
      hooks: {
        async onUsageReported(payload: {
          owner: { kind: "user" | "organization"; id: string; email?: string };
          key: string;
          quantity: number;
          idempotencyKey: string;
          occurredAt: string;
          eventName: string;
          customerId: string | null;
          projectedCurrentPeriodUsed: number | null;
        }) {
          console.log("[polar-example:usage-reported]", payload);
        },
      },
    },
    log(event: { phase: string; route?: { path?: string } }) {
      console.log("[polar-example]", event.phase, event.route?.path || "none");
    },
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;

export function summarizeUsageProperties(
  properties: PolarBillingUsageProperties | undefined,
) {
  return properties ? JSON.stringify(properties, null, 2) : "{}";
}
