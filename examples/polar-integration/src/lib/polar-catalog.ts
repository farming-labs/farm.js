import type { PolarBillingPlan, PolarBillingProduct } from "@farm.js/polar";

export const polarPlans: Record<string, PolarBillingPlan> = {
  free: {
    public: true,
    features: {
      billingPortal: false,
      meteredUsage: false,
    },
    limits: {
      tokensMonthly: 100_000,
    },
  },
  pro: {
    public: true,
    trial: {
      days: 7,
    },
    features: {
      billingPortal: true,
      meteredUsage: true,
    },
    limits: {
      tokensMonthly: 1_000_000,
    },
  },
  business: {
    public: true,
    trial: {
      days: 14,
    },
    features: {
      billingPortal: true,
      meteredUsage: true,
      prioritySupport: true,
      sso: true,
    },
    limits: {
      tokensMonthly: 10_000_000,
    },
  },
} as const;

export const polarProducts: Record<string, PolarBillingProduct> = {
  ...(process.env.POLAR_PRO_MONTHLY_PRODUCT_ID
    ? {
        proMonthly: {
          kind: "subscription",
          planId: "pro",
          name: "Pro Monthly",
          description: "Recurring access to the Pro workspace plan.",
          currency: "usd",
          unitAmount: 1200,
          interval: "month",
          polar: {
            productId: process.env.POLAR_PRO_MONTHLY_PRODUCT_ID,
          },
        } satisfies PolarBillingProduct,
      }
    : {}),
  ...(process.env.POLAR_PRO_YEARLY_PRODUCT_ID
    ? {
        proYearly: {
          kind: "subscription",
          planId: "pro",
          name: "Pro Yearly",
          description: "Annual access to the Pro workspace plan.",
          currency: "usd",
          unitAmount: 12000,
          interval: "year",
          polar: {
            productId: process.env.POLAR_PRO_YEARLY_PRODUCT_ID,
          },
        } satisfies PolarBillingProduct,
      }
    : {}),
  ...(process.env.POLAR_BUSINESS_MONTHLY_PRODUCT_ID
    ? {
        businessMonthly: {
          kind: "subscription",
          planId: "business",
          name: "Business Monthly",
          description: "Recurring access to the Business workspace plan.",
          currency: "usd",
          unitAmount: 4900,
          interval: "month",
          polar: {
            productId: process.env.POLAR_BUSINESS_MONTHLY_PRODUCT_ID,
          },
        } satisfies PolarBillingProduct,
      }
    : {}),
  ...(process.env.POLAR_BUSINESS_YEARLY_PRODUCT_ID
    ? {
        businessYearly: {
          kind: "subscription",
          planId: "business",
          name: "Business Yearly",
          description: "Annual access to the Business workspace plan.",
          currency: "usd",
          unitAmount: 49000,
          interval: "year",
          polar: {
            productId: process.env.POLAR_BUSINESS_YEARLY_PRODUCT_ID,
          },
        } satisfies PolarBillingProduct,
      }
    : {}),
  ...(process.env.POLAR_TOKEN_PACK_PRODUCT_ID
    ? {
        tokenPack: {
          kind: "one_time",
          name: "Token Top-Up Pack",
          description: "One-time Polar purchase for token credits or usage top-ups.",
          currency: "usd",
          unitAmount: 2500,
          polar: {
            productId: process.env.POLAR_TOKEN_PACK_PRODUCT_ID,
          },
        } satisfies PolarBillingProduct,
      }
    : {}),
} as const;
