import type { AutumnBillingPlan, AutumnBillingProduct } from "@farm.js/integrations";

export const autumnPlans: Record<string, AutumnBillingPlan> = {
  free: {
    public: true,
    features: {
      billingPortal: false,
      meteredUsage: false,
    },
    limits: {
      seats: 4,
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
      seats: 5,
      tokensMonthly: 1_000_000,
    },
  },
  business: {
    public: true,
    trial: {
      days: 7,
    },
    features: {
      billingPortal: true,
      meteredUsage: true,
      prioritySupport: true,
      sso: true,
    },
    limits: {
      seats: 25,
      tokensMonthly: 10_000_000,
    },
  },
} as const;

export const autumnProducts: Record<string, AutumnBillingProduct> = {
  ...(process.env.AUTUMN_PRO_MONTHLY_PLAN_ID
    ? {
        proMonthly: {
          kind: "subscription",
          planId: "pro",
          name: "Pro Monthly",
          description: "Recurring access to the Pro workspace plan.",
          currency: "usd",
          unitAmount: 2000,
          interval: "month",
          autumnPlanId: process.env.AUTUMN_PRO_MONTHLY_PLAN_ID,
          autumn: process.env.AUTUMN_SEATS_FEATURE_ID
            ? {
                items: [
                  {
                    featureId: process.env.AUTUMN_SEATS_FEATURE_ID,
                    included: 5,
                    price: {
                      amount: 10,
                      interval: "month",
                      billingUnits: 1,
                      billingMethod: "prepaid",
                    },
                  },
                ],
              }
            : undefined,
        } satisfies AutumnBillingProduct,
      }
    : {}),
  ...(process.env.AUTUMN_PRO_YEARLY_PLAN_ID
    ? {
        proYearly: {
          kind: "subscription",
          planId: "pro",
          name: "Pro Yearly",
          description: "Annual access to the Pro workspace plan.",
          currency: "usd",
          unitAmount: 10000,
          interval: "year",
          autumnPlanId: process.env.AUTUMN_PRO_YEARLY_PLAN_ID,
          autumn: process.env.AUTUMN_SEATS_FEATURE_ID
            ? {
                items: [
                  {
                    featureId: process.env.AUTUMN_SEATS_FEATURE_ID,
                    included: 5,
                    price: {
                      amount: 100,
                      interval: "year",
                      billingUnits: 1,
                      billingMethod: "prepaid",
                    },
                  },
                ],
              }
            : undefined,
        } satisfies AutumnBillingProduct,
      }
    : {}),
  ...(process.env.AUTUMN_BUSINESS_MONTHLY_PLAN_ID
    ? {
        businessMonthly: {
          kind: "subscription",
          planId: "business",
          name: "Business Monthly",
          description: "Recurring access to the Business workspace plan.",
          currency: "usd",
          unitAmount: 4000,
          interval: "month",
          autumnPlanId: process.env.AUTUMN_BUSINESS_MONTHLY_PLAN_ID,
          autumn: process.env.AUTUMN_SEATS_FEATURE_ID
            ? {
                items: [
                  {
                    featureId: process.env.AUTUMN_SEATS_FEATURE_ID,
                    included: 25,
                    price: {
                      amount: 10,
                      interval: "month",
                      billingUnits: 1,
                      billingMethod: "prepaid",
                    },
                  },
                ],
              }
            : undefined,
        } satisfies AutumnBillingProduct,
      }
    : {}),
  ...(process.env.AUTUMN_BUSINESS_YEARLY_PLAN_ID
    ? {
        businessYearly: {
          kind: "subscription",
          planId: "business",
          name: "Business Yearly",
          description: "Annual access to the Business workspace plan.",
          currency: "usd",
          unitAmount: 15000,
          interval: "year",
          autumnPlanId: process.env.AUTUMN_BUSINESS_YEARLY_PLAN_ID,
          autumn: process.env.AUTUMN_SEATS_FEATURE_ID
            ? {
                items: [
                  {
                    featureId: process.env.AUTUMN_SEATS_FEATURE_ID,
                    included: 25,
                    price: {
                      amount: 100,
                      interval: "year",
                      billingUnits: 1,
                      billingMethod: "prepaid",
                    },
                  },
                ],
              }
            : undefined,
        } satisfies AutumnBillingProduct,
      }
    : {}),
  ...(process.env.AUTUMN_TOKEN_PACK_PLAN_ID
    ? {
        tokenPack: {
          kind: "one_time",
          name: "Token Top-Up Pack",
          description: "One-time Autumn purchase for token credits or usage top-ups.",
          currency: "usd",
          unitAmount: 2500,
          autumnPlanId: process.env.AUTUMN_TOKEN_PACK_PLAN_ID,
        } satisfies AutumnBillingProduct,
      }
    : {}),
} as const;
