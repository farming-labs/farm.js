import type {
  StripeBillingPlan,
  StripeBillingProduct,
} from "@farm.js/stripe";
import { getExampleEnv } from "./env.ts";

const proMonthlyMeterPriceIds = Object.fromEntries(
  [
    ["tokensMonthly", getExampleEnv("STRIPE_PRO_TOKENS_METER_MONTHLY_PRICE_ID")],
    ["apiCalls", getExampleEnv("STRIPE_PRO_API_CALLS_METER_MONTHLY_PRICE_ID")],
  ].flatMap(([key, value]) =>
    typeof value === "string" && value.length > 0 ? [[key, value] as const] : [],
  ),
);

const businessMonthlyMeterPriceIds = Object.fromEntries(
  [
    ["tokensMonthly", getExampleEnv("STRIPE_BUSINESS_TOKENS_METER_MONTHLY_PRICE_ID")],
    ["apiCalls", getExampleEnv("STRIPE_BUSINESS_API_CALLS_METER_MONTHLY_PRICE_ID")],
  ].flatMap(([key, value]) =>
    typeof value === "string" && value.length > 0 ? [[key, value] as const] : [],
  ),
);

export const stripePlans: Record<string, StripeBillingPlan> = {
  free: {
    public: true,
    features: {
      analytics: false,
      billingPortal: false,
      prioritySupport: false,
      sso: false,
    },
    limits: {
      seats: 4,
      projects: 1,
      tokensMonthly: 100_000,
      apiCalls: 5_000,
    },
  },
  pro: {
    public: true,
    trial: {
      days: 7,
    },
    features: {
      analytics: true,
      billingPortal: true,
      prioritySupport: false,
      sso: false,
    },
    limits: {
      seats: 5,
      projects: 10,
      tokensMonthly: 1_000_000,
      apiCalls: 50_000,
    },
  },
  business: {
    public: true,
    trial: {
      days: 14,
    },
    features: {
      analytics: true,
      billingPortal: true,
      prioritySupport: true,
      sso: true,
    },
    limits: {
      seats: 25,
      projects: -1,
      tokensMonthly: 10_000_000,
      apiCalls: 500_000,
    },
  },
};

export const stripeProducts: Record<string, StripeBillingProduct> = {
  proMonthly: {
    public: true,
    kind: "subscription",
    planId: "pro",
    name: "Pro Monthly",
    description:
      "Recurring access to the Pro organization plan billed every month with 5 included seats plus metered overage for tokens and API calls.",
    currency: "usd",
    unitAmount: 1200,
    interval: "month",
    quantity: 5,
    seatBilling: "included_plus_add_on",
    stripe: {
      seatPriceId: getExampleEnv("STRIPE_PRO_EXTRA_SEAT_MONTHLY_PRICE_ID"),
      meterPriceIds:
        Object.keys(proMonthlyMeterPriceIds).length > 0 ? proMonthlyMeterPriceIds : undefined,
    },
  },
  proYearly: {
    public: true,
    kind: "subscription",
    planId: "pro",
    name: "Pro Yearly",
    description:
      "Recurring access to the Pro organization plan billed every year with 5 included seats. In this demo, metered overage remains attached to the monthly products.",
    currency: "usd",
    unitAmount: 12000,
    interval: "year",
    quantity: 5,
    seatBilling: "included_plus_add_on",
    stripe: {
      seatPriceId: getExampleEnv("STRIPE_PRO_EXTRA_SEAT_YEARLY_PRICE_ID"),
    },
  },
  businessMonthly: {
    public: true,
    kind: "subscription",
    planId: "business",
    name: "Business Monthly",
    description:
      "Business organization billing with SSO, higher limits, 25 included seats, and metered overage for tokens and API calls, billed monthly.",
    currency: "usd",
    unitAmount: 4900,
    interval: "month",
    quantity: 25,
    seatBilling: "included_plus_add_on",
    stripe: {
      seatPriceId: getExampleEnv("STRIPE_BUSINESS_EXTRA_SEAT_MONTHLY_PRICE_ID"),
      meterPriceIds:
        Object.keys(businessMonthlyMeterPriceIds).length > 0
          ? businessMonthlyMeterPriceIds
          : undefined,
    },
  },
  businessYearly: {
    public: true,
    kind: "subscription",
    planId: "business",
    name: "Business Yearly",
    description:
      "Business organization billing with SSO, higher limits, and 25 included seats, billed yearly. In this demo, metered overage remains attached to the monthly products.",
    currency: "usd",
    unitAmount: 49000,
    interval: "year",
    quantity: 25,
    seatBilling: "included_plus_add_on",
    stripe: {
      seatPriceId: getExampleEnv("STRIPE_BUSINESS_EXTRA_SEAT_YEARLY_PRICE_ID"),
    },
  },
};
