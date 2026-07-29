import type { StripeIntegrationProduct } from "@farm.js/stripe/client";

export const stripeCatalog: StripeIntegrationProduct[] = [
  {
    id: "pro-yearly",
    mode: "subscription",
    interval: "year",
    quantity: 1,
  },
  {
    id: "supporter-pack",
    mode: "payment",
    quantity: 1,
  },
];
