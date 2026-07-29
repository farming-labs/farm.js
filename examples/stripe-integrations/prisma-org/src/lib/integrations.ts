import Stripe from "stripe";
import { betterAuth as farmBetterAuth } from "@farm.js/integrations/better-auth";
import {
  prismaStorageAdapter,
  stripe,
  type StripeBillingHooks,
  type StripeBillingOwner,
  type StripeBillingSnapshot,
  type StripeWebhookEvent,
} from "@farm.js/integrations/stripe";
import { auth } from "./auth.ts";
import { getExampleEnv, requireExampleEnv } from "./env.ts";
import { organizationToolsIntegration } from "./organization-tools.ts";
import {
  countReservedOrganizationSeats,
  countOrganizationProjects,
  resolveOrganizationBillingOwner,
  sumOrganizationTokensThisMonth,
} from "./organization-server.ts";
import { prisma } from "./prisma.ts";
import { stripePlans, stripeProducts } from "./stripe-catalog.ts";

function summarizeBillingSnapshot(snapshot: StripeBillingSnapshot) {
  return {
    ownerKind: snapshot.owner.kind,
    ownerId: snapshot.owner.id,
    ownerEmail: snapshot.owner.email ?? null,
    planId: snapshot.planId,
    productId: snapshot.productId,
    status: snapshot.status,
    stripeCustomerId: snapshot.stripeCustomerId,
    stripeSubscriptionId: snapshot.stripeSubscriptionId,
    currentPeriodEnd: snapshot.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    trialEndsAt: snapshot.trialEndsAt?.toISOString() ?? null,
    trialUsedAt: snapshot.trialUsedAt?.toISOString() ?? null,
    seatQuantity: snapshot.seatQuantity,
    seatAllowanceOverride: snapshot.seatAllowanceOverride,
    metadata: snapshot.metadata ?? {},
  };
}

function logBillingEvent(label: string, payload: unknown) {
  console.log(`[stripe-prisma-org-example:${label}]`, payload);
}

const stripeInstance = new Stripe(
  requireExampleEnv(
    "STRIPE_SECRET_KEY",
    "Stripe Prisma org example requires STRIPE_SECRET_KEY.",
  ),
);

const stripeBillingHooks = {
  async onCheckoutCreated(payload) {
    logBillingEvent("checkout-created", payload);
  },
  async onCheckoutCompleted(snapshot: StripeBillingSnapshot & { sessionId: string }) {
    logBillingEvent("checkout-completed", {
      sessionId: snapshot.sessionId,
      snapshot: summarizeBillingSnapshot(snapshot),
    });
  },
  async onBillingSync(snapshot: StripeBillingSnapshot) {
    logBillingEvent("billing-sync", summarizeBillingSnapshot(snapshot));
  },
  async onTrialStarted(snapshot) {
    logBillingEvent("trial-started", {
      trialDays: snapshot.trialDays,
      snapshot: summarizeBillingSnapshot(snapshot),
    });
  },
  async onTrialWillEnd(snapshot) {
    logBillingEvent("trial-will-end", summarizeBillingSnapshot(snapshot));
  },
  async onTrialEnded(snapshot) {
    logBillingEvent("trial-ended", summarizeBillingSnapshot(snapshot));
  },
  async onTrialExpired(snapshot) {
    logBillingEvent("trial-expired", summarizeBillingSnapshot(snapshot));
  },
  async onPaymentSucceeded(snapshot) {
    logBillingEvent("payment-succeeded", summarizeBillingSnapshot(snapshot));
  },
  async onPaymentFailed(snapshot) {
    logBillingEvent("payment-failed", summarizeBillingSnapshot(snapshot));
  },
  async onUsageReported(payload) {
    logBillingEvent("usage-reported", payload);
  },
} satisfies StripeBillingHooks;

export const appIntegrations = {
  auth: farmBetterAuth({
    instance: auth,
    log(event: { phase: string; route?: { path?: string } }) {
      console.log(
        "[stripe-prisma-org-example:better-auth]",
        event.phase,
        event.route?.path || "none",
      );
    },
  }),
  billing: stripe({
    instance: stripeInstance,
    appBaseUrl: getExampleEnv("APP_BASE_URL") ?? getExampleEnv("BETTER_AUTH_URL"),
    webhooks: {
      secret: getExampleEnv("STRIPE_WEBHOOK_SECRET"),
      async onEvent(event: StripeWebhookEvent) {
        console.log("[stripe-prisma-org-example:webhook]", event.type, event.id);
      },
    },
    billing: {
      resolveOwner: resolveOrganizationBillingOwner,
      plans: stripePlans,
      products: stripeProducts,
      seats: {
        mode: "subscription_quantity",
      },
      meters: {
        tokensMonthly: {
          aggregation: "sum",
          ingestion: "raw",
          eventName: "ai_tokens",
          unit: "tokens",
          guard: {
            softLimit: "plan_limit",
            hardOverageByPlan: {
              pro: 2_000_000,
              business: 5_000_000,
            },
            blockOnPastDue: true,
          },
        },
        apiCalls: {
          aggregation: "count",
          ingestion: "raw",
          eventName: "api_calls",
          unit: "requests",
          guard: {
            softLimit: "plan_limit",
            hardOverageByPlan: {
              pro: 100_000,
              business: 500_000,
            },
            blockOnPastDue: true,
          },
        },
      },
      usage: {
        async resolve(owner: StripeBillingOwner, key: string) {
          if (owner.kind !== "organization") {
            return null;
          }

          let value: number | null = null;
          switch (key) {
            case "seats":
              value = countReservedOrganizationSeats(owner.id);
              break;
            case "projects":
              value = await countOrganizationProjects(owner.id);
              break;
            case "tokensMonthly":
              value = await sumOrganizationTokensThisMonth(owner.id);
              break;
            default:
              value = null;
              break;
          }

          logBillingEvent("billing-usage", {
            ownerKind: owner.kind,
            ownerId: owner.id,
            key,
            value,
          });

          return value;
        },
      },
      storage: prismaStorageAdapter({
        prisma,
      }),
      hooks: stripeBillingHooks,
    },
    log(event: { phase: string; route?: { path?: string } }) {
      console.log(
        "[stripe-prisma-org-example:stripe]",
        event.phase,
        event.route?.path || "none",
      );
    },
  }),
  organization: organizationToolsIntegration,
} as const;

export type AppIntegrations = typeof appIntegrations;
