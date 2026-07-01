import Stripe from "stripe";
import type { FarmIntegrationLogEvent } from "@farmjs/core";
import { stripe, type StripeWebhookEvent } from "@farmjs/integrations/stripe";
import { stripeCatalog } from "./stripe-catalog.ts";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  throw new Error(
    "Stripe example requires STRIPE_SECRET_KEY. Add it to examples/stripe-integration/.env.local.",
  );
}

const stripeInstance = new Stripe(stripeSecretKey);
const stripeProducts = stripeCatalog.map((product) => {
  if (product.id === "pro-yearly" && process.env.STRIPE_PRO_YEARLY_PRICE_ID) {
    return {
      ...product,
      priceId: process.env.STRIPE_PRO_YEARLY_PRICE_ID,
    };
  }

  if (product.id === "supporter-pack" && process.env.STRIPE_SUPPORTER_PACK_PRICE_ID) {
    return {
      ...product,
      priceId: process.env.STRIPE_SUPPORTER_PACK_PRICE_ID,
    };
  }

  return product;
});

export const appIntegrations = {
  billing: stripe({
    products: stripeProducts,
    instance: stripeInstance,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    log(event: FarmIntegrationLogEvent) {
      console.log("[stripe-example]", event.phase, event.route?.path || "none");
    },
    async onWebhook(event: StripeWebhookEvent) {
      console.log("[stripe-example:webhook]", event.type, event.id);
    },
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
