import Stripe from "stripe";
import type { FarmIntegrationLogEvent } from "@farm.js/core";
import { betterAuth as farmBetterAuth } from "@farm.js/better-auth";
import { stripe, type StripeWebhookEvent } from "@farm.js/stripe";
import { auth } from "./auth.ts";
import { getExampleEnv, requireExampleEnv } from "./env.ts";
import { stripeProducts } from "./stripe-catalog.ts";

const integrationProducts = Object.entries(stripeProducts).map(([id, product]) => ({
  id,
  ...product,
  mode: product.kind === "one_time" ? "payment" as const : "subscription" as const,
}));

const stripeInstance = new Stripe(
  requireExampleEnv(
    "STRIPE_SECRET_KEY",
    "Stripe Prisma example requires STRIPE_SECRET_KEY.",
  ),
);

export const appIntegrations = {
  auth: farmBetterAuth({
    instance: auth,
    log(event) {
      console.log("[stripe-prisma-example:better-auth]", event.phase, event.route?.path || "none");
    },
  }),
  billing: stripe({
    products: integrationProducts,
    instance: stripeInstance,
    webhookSecret: getExampleEnv("STRIPE_WEBHOOK_SECRET"),
    appBaseUrl: getExampleEnv("APP_BASE_URL") ?? getExampleEnv("BETTER_AUTH_URL"),
    log(event: FarmIntegrationLogEvent) {
      console.log("[stripe-prisma-example:stripe]", event.phase, event.route?.path || "none");
    },
    async onWebhook(event: StripeWebhookEvent) {
      console.log("[stripe-prisma-example:webhook]", event.type, event.id);
    },
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
