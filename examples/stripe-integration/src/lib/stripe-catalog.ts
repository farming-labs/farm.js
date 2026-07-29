import type { StripeIntegrationProduct } from "@farm.js/stripe/client";

export const stripeCatalog: StripeIntegrationProduct[] = [
  {
    id: "pro-yearly",
    name: "Pro Yearly",
    currency: "usd",
    unitAmount: 12000,
    mode: "subscription",
    interval: "year",
    quantity: 1,
  },
  {
    id: "supporter-pack",
    name: "Supporter Pack",
    currency: "usd",
    unitAmount: 2500,
    mode: "payment",
    quantity: 1,
  },
];
