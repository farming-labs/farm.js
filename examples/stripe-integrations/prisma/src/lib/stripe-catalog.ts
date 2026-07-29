import type {
  StripeBillingPlan,
  StripeBillingProduct,
} from "@farm.js/stripe";

export const stripePlans: Record<string, StripeBillingPlan> = {
  free: {
    public: true,
    entitlements: {
      seats: 1,
      projects: 1,
      features: {
        billingPortal: false,
        analytics: false,
        prioritySupport: false,
        sso: false,
      },
    },
  },
  pro: {
    public: true,
    entitlements: {
      seats: 5,
      projects: 10,
      features: {
        billingPortal: true,
        analytics: true,
        prioritySupport: false,
        sso: false,
      },
    },
  },
  business: {
    public: true,
    entitlements: {
      seats: 25,
      projects: -1,
      features: {
        billingPortal: true,
        analytics: true,
        prioritySupport: true,
        sso: true,
      },
    },
  },
};

export const stripeProducts: Record<string, StripeBillingProduct> = {
  proMonthly: {
    public: true,
    kind: "subscription",
    planId: "pro",
    name: "Pro Monthly",
    description: "Recurring access to the Pro plan billed every month.",
    currency: "usd",
    unitAmount: 1200,
    interval: "month",
    quantity: 1,
  },
  proYearly: {
    public: true,
    kind: "subscription",
    planId: "pro",
    name: "Pro Yearly",
    description: "Recurring access to the Pro plan billed every year.",
    currency: "usd",
    unitAmount: 12000,
    interval: "year",
    quantity: 1,
  },
  businessMonthly: {
    public: true,
    kind: "subscription",
    planId: "business",
    name: "Business Monthly",
    description: "Business plan with advanced collaboration and SSO, billed monthly.",
    currency: "usd",
    unitAmount: 4900,
    interval: "month",
    quantity: 1,
  },
  businessYearly: {
    public: true,
    kind: "subscription",
    planId: "business",
    name: "Business Yearly",
    description: "Business plan with advanced collaboration and SSO, billed yearly.",
    currency: "usd",
    unitAmount: 49000,
    interval: "year",
    quantity: 1,
  },
};
