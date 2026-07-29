import Stripe from "stripe";
import type { FarmIntegrationHandlerContext, FarmIntegrationLogEvent } from "@farm.js/core";
import { betterAuth as farmBetterAuth } from "@farm.js/integrations/better-auth";
import {
  stripe,
  type StripeBillingHooks,
  type StripeBillingOptions,
  type StripeWebhookEvent,
} from "@farm.js/integrations/stripe";
import { auth } from "./auth.ts";
import {
  getBillingSnapshotByCustomerId,
  getBillingSnapshotByOwner,
  persistBillingSnapshot,
  persistStripeCustomerLink,
  recordBillingHookEvent,
  resetBillingSnapshot,
} from "./billing-db.ts";
import { getExampleEnv, requireExampleEnv } from "./env.ts";
import { stripePlans, stripeProducts } from "./stripe-catalog.ts";

const stripeInstance = new Stripe(
  requireExampleEnv(
    "STRIPE_SECRET_KEY",
    "Stripe SQLite example requires STRIPE_SECRET_KEY.",
  ),
);

const stripeBillingHooks = {
  async getBillingAccount(owner) {
    const snapshot = getBillingSnapshotByOwner(owner);
    recordBillingHookEvent("getBillingAccount", {
      owner,
      found: !!snapshot,
      planId: snapshot?.planId ?? null,
      productId: snapshot?.productId ?? null,
      status: snapshot?.status ?? null,
      stripeCustomerId: snapshot?.stripeCustomerId ?? null,
    });
    return snapshot;
  },
  async getBillingAccountByStripeCustomerId(customerId) {
    const snapshot = getBillingSnapshotByCustomerId(customerId);
    recordBillingHookEvent("getBillingAccountByStripeCustomerId", {
      customerId,
      owner: snapshot?.owner ?? null,
      found: !!snapshot,
      planId: snapshot?.planId ?? null,
      productId: snapshot?.productId ?? null,
      status: snapshot?.status ?? null,
      stripeCustomerId: snapshot?.stripeCustomerId ?? null,
    });
    return snapshot;
  },
  async ensureCustomer(owner, tools) {
    const existing = getBillingSnapshotByOwner(owner);
    if (existing?.stripeCustomerId) {
      recordBillingHookEvent("ensureCustomer", {
        owner,
        reused: true,
        stripeCustomerId: existing.stripeCustomerId,
      });
      return {
        customerId: existing.stripeCustomerId,
      };
    }

    const stripeSdk = tools.stripe;
    if (!stripeSdk) {
      throw new Error("SQLite hooks example requires a real Stripe SDK instance.");
    }

    const customer = await stripeSdk.customers.create({
      email: owner.email,
      metadata: {
        ownerId: owner.id,
        ownerKind: owner.kind,
      },
    });

    persistStripeCustomerLink(owner, customer.id);
    recordBillingHookEvent("ensureCustomer", {
      owner,
      reused: false,
      stripeCustomerId: customer.id,
    });

    return {
      customerId: customer.id,
    };
  },
  async saveBillingSnapshot(snapshot) {
    persistBillingSnapshot(snapshot);
    recordBillingHookEvent("saveBillingSnapshot", {
      owner: snapshot.owner,
      planId: snapshot.planId,
      productId: snapshot.productId,
      status: snapshot.status,
      stripeCustomerId: snapshot.stripeCustomerId,
      stripeSubscriptionId: snapshot.stripeSubscriptionId,
      currentPeriodEnd: snapshot.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    });
  },
  async clearBillingSnapshot(owner) {
    resetBillingSnapshot(owner);
    recordBillingHookEvent("clearBillingSnapshot", {
      owner,
    });
  },
  async onCheckoutCreated(payload) {
    recordBillingHookEvent("onCheckoutCreated", payload);
  },
  async onCheckoutCompleted(payload) {
    recordBillingHookEvent("onCheckoutCompleted", {
      owner: payload.owner,
      sessionId: payload.sessionId,
      planId: payload.planId,
      productId: payload.productId,
      status: payload.status,
      stripeCustomerId: payload.stripeCustomerId,
      stripeSubscriptionId: payload.stripeSubscriptionId,
    });
  },
  async onBillingSync(snapshot) {
    recordBillingHookEvent("onBillingSync", {
      owner: snapshot.owner,
      planId: snapshot.planId,
      productId: snapshot.productId,
      status: snapshot.status,
      stripeCustomerId: snapshot.stripeCustomerId,
      stripeSubscriptionId: snapshot.stripeSubscriptionId,
    });
  },
  async onPaymentSucceeded(snapshot) {
    recordBillingHookEvent("onPaymentSucceeded", {
      owner: snapshot.owner,
      planId: snapshot.planId,
      productId: snapshot.productId,
      status: snapshot.status,
      stripeCustomerId: snapshot.stripeCustomerId,
      stripeSubscriptionId: snapshot.stripeSubscriptionId,
    });
  },
  async onPaymentFailed(snapshot) {
    recordBillingHookEvent("onPaymentFailed", {
      owner: snapshot.owner,
      planId: snapshot.planId,
      productId: snapshot.productId,
      status: snapshot.status,
      stripeCustomerId: snapshot.stripeCustomerId,
      stripeSubscriptionId: snapshot.stripeSubscriptionId,
    });
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
  hooks: stripeBillingHooks,
} satisfies StripeBillingOptions;

export const appIntegrations = {
  auth: farmBetterAuth({
    instance: auth,
    log(event: FarmIntegrationLogEvent) {
      console.log("[stripe-sqlite-example:better-auth]", event.phase, event.route?.path || "none");
    },
  }),
  billing: stripe({
    instance: stripeInstance,
    webhookSecret: getExampleEnv("STRIPE_WEBHOOK_SECRET"),
    appBaseUrl: getExampleEnv("APP_BASE_URL") ?? getExampleEnv("BETTER_AUTH_URL"),
    billing: stripeBilling,
    log(event: FarmIntegrationLogEvent) {
      console.log("[stripe-sqlite-example:stripe]", event.phase, event.route?.path || "none");
    },
    async onWebhook(event: StripeWebhookEvent) {
      console.log("[stripe-sqlite-example:webhook]", event.type, event.id);
    },
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
