import Stripe from "stripe";
import type { FarmIntegrationHandlerContext, FarmIntegrationLogEvent } from "@farm.js/core";
import { betterAuth as farmBetterAuth } from "@farm.js/better-auth";
import {
  drizzleStorageAdapter,
  stripe,
  type StripeBillingHooks,
  type StripeBillingOptions,
  type StripeWebhookEvent,
} from "@farm.js/stripe";
import { auth } from "./auth.ts";
import { and, billingBillingAccount, drizzleDb, eq } from "./drizzle.ts";
import { getExampleEnv, requireExampleEnv } from "./env.ts";
import { stripePlans, stripeProducts } from "./stripe-catalog.ts";

const stripeInstance = new Stripe(
  requireExampleEnv(
    "STRIPE_SECRET_KEY",
    "Stripe Drizzle example requires STRIPE_SECRET_KEY.",
  ),
);

const stripeBillingHooks = {
  async onBillingSync(snapshot) {
    console.log("[stripe-drizzle-example:billing-sync]", snapshot);
  },
} satisfies StripeBillingHooks;

const stripeBilling = {
  async resolveOwner(ctx: FarmIntegrationHandlerContext) {
    const session = await (auth.api as {
      getSession(input: { headers: Headers }): Promise<{
        user?: { id?: string; email?: string | null } | null;
      } | null>;
    }).getSession({
      headers: ctx.request.headers,
    });

    const user = session?.user;
    if (!user?.id) {
      return null;
    }

    return {
      kind: "user" as const,
      id: user.id,
      email: user.email ?? undefined,
    };
  },
  plans: stripePlans,
  products: stripeProducts,
  storage: drizzleStorageAdapter({
    db: drizzleDb,
    table: billingBillingAccount as unknown as Record<string, unknown>,
    eq,
    and,
  }),
  hooks: stripeBillingHooks,
} satisfies StripeBillingOptions;

export const appIntegrations = {
  auth: farmBetterAuth({
    instance: auth,
    log(event: FarmIntegrationLogEvent) {
      console.log("[stripe-drizzle-example:better-auth]", event.phase, event.route?.path || "none");
    },
  }),
  billing: stripe({
    instance: stripeInstance,
    webhookSecret: getExampleEnv("STRIPE_WEBHOOK_SECRET"),
    appBaseUrl: getExampleEnv("APP_BASE_URL") ?? getExampleEnv("BETTER_AUTH_URL"),
    billing: stripeBilling,
    log(event: FarmIntegrationLogEvent) {
      console.log("[stripe-drizzle-example:stripe]", event.phase, event.route?.path || "none");
    },
    async onWebhook(event: StripeWebhookEvent) {
      console.log("[stripe-drizzle-example:webhook]", event.type, event.id);
    },
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
