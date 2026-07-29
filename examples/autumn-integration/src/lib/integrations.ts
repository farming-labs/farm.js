import { betterAuth as farmBetterAuth } from "@farm.js/better-auth";
import { autumn, type AutumnBillingUsageProperties, type AutumnWebhookEvent } from "@farm.js/autumn";
import { auth } from "./auth.ts";
import { resolveOrganizationBillingOwner } from "./organization-server.ts";
import { autumnPlans, autumnProducts } from "./autumn-catalog.ts";

const autumnSecretKey = process.env.AUTUMN_SECRET_KEY;
const autumnMeters = {
  ...(process.env.AUTUMN_TOKENS_FEATURE_ID
    ? {
        tokensMonthly: {
          aggregation: "sum" as const,
          ingestion: "raw" as const,
          eventName: process.env.AUTUMN_TOKENS_EVENT_NAME ?? "ai_usage",
          unit: "tokens",
          featureId: process.env.AUTUMN_TOKENS_FEATURE_ID,
          guard: {
            softLimit: "plan_limit" as const,
            hardOverageByPlan: {
              pro: 2_000_000,
              business: 5_000_000,
            },
          },
        },
      }
    : {}),
  ...(process.env.AUTUMN_SEATS_FEATURE_ID
    ? {
        seats: {
          aggregation: "last" as const,
          ingestion: "pre_aggregated" as const,
          eventName: process.env.AUTUMN_SEATS_EVENT_NAME ?? "seat_quantity",
          unit: "seats",
          featureId: process.env.AUTUMN_SEATS_FEATURE_ID,
          guard: {
            softLimit: "plan_limit" as const,
          },
        },
      }
    : {}),
} as const;

if (!autumnSecretKey) {
  throw new Error(
    "Autumn example requires AUTUMN_SECRET_KEY. Add it to examples/autumn-integration/.env.local.",
  );
}

export const appIntegrations = {
  auth: farmBetterAuth({
    instance: auth,
    log(event: { phase: string; route?: { path?: string } }) {
      console.log("[autumn-example:better-auth]", event.phase, event.route?.path || "none");
    },
  }),
  billing: autumn({
    secretKey: autumnSecretKey,
    appBaseUrl: process.env.APP_BASE_URL,
    webhooks: process.env.AUTUMN_WEBHOOK_SECRET
      ? {
          secret: process.env.AUTUMN_WEBHOOK_SECRET,
          async onEvent(event: AutumnWebhookEvent) {
            console.log("[autumn-example:webhook]", event.type, event.id);
          },
        }
      : undefined,
    billing: {
      resolveOwner: resolveOrganizationBillingOwner,
      plans: autumnPlans,
      products: autumnProducts,
      meters: Object.keys(autumnMeters).length > 0 ? autumnMeters : undefined,
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
          console.log("[autumn-example:usage-reported]", payload);
        },
      },
    },
    log(event: { phase: string; route?: { path?: string } }) {
      console.log("[autumn-example]", event.phase, event.route?.path || "none");
    },
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;

export function summarizeUsageProperties(
  properties: AutumnBillingUsageProperties | undefined,
) {
  return properties ? JSON.stringify(properties, null, 2) : "{}";
}
