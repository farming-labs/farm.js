import Stripe from "stripe";
import {
  createIntegrationOrm,
  defineIntegration,
  integrationRoute,
  type FarmIntegration,
  type FarmIntegrationAPI,
  type FarmIntegrationHandlerContext,
  type FarmIntegrationLogger,
  type FarmIntegrationSchema,
} from "@farmjs/core";
import {
  normalizeWebhookConfig,
  resolveAppPath,
  toAbsoluteUrl,
  withSearchParams,
} from "../utils/index.js";
import type { FarmWebhookConfig, FarmWebhookEvent } from "../utils/webhooks.js";
import {
  type StripeBillingCurrentChargeLine,
  type StripeBillingCurrentChargesResult,
  type StripeBillingCheckInput,
  type StripeBillingCheckResult,
  type StripeBillingMeterUsageInput,
  type StripeBillingMeterUsageResult,
  type StripeBillingUpcomingInvoiceLineKind,
  type StripeBillingUpcomingInvoiceLineResult,
  type StripeBillingUpcomingInvoiceResult,
  type StripeBillingUpcomingInvoiceTotalsResult,
  type StripeBillingReportUsageInput,
  type StripeBillingReportUsageResult,
  type StripeBillingUpgradeInput,
  type StripeBillingUpgradeProrationBehavior,
  type StripeBillingUpgradeResult,
  type StripeBillingFeaturesResult,
  type StripeBillingLimitsResult,
  type StripeBillingUsageInput,
  type StripeBillingUsageResult,
  type StripeBillingStatusResult,
  type StripeCatalogMeterPrice,
  type StripeCatalogProduct,
  type StripeClientAPI,
  type StripeDefaultClientAPI,
  createStripeClientApi,
  type StripeCheckoutInput,
  type StripeCheckoutResult,
  type StripeCheckoutTrialBehavior,
  type StripeIntegrationProduct,
  type StripePortalInput,
  type StripePortalResult,
  type StripeSessionLineItemResult,
  type StripeSessionQuery,
  type StripeSessionResult,
  type StripeWebhookResult,
} from "./client.js";
import {
  drizzleStorageAdapter,
  ormStorageAdapter,
  prismaStorageAdapter,
  sqliteStorageAdapter,
  type StripeBillingFeatures,
  type StripeBillingHookTools,
  type StripeBillingHooks,
  type StripeBillingLimits,
  type StripeBillingMeter,
  type StripeBillingMeterState,
  type StripeBillingOptions,
  type StripeBillingOwner,
  type StripeBillingPlan,
  type StripeBillingProduct,
  type StripeBillingPlanLimitReference,
  type StripeBillingProductKind,
  type StripeBillingSeatLimitSource,
  type StripeBillingSeatsMode,
  type StripeBillingSeatsOptions,
  type StripeBillingSnapshot,
  type StripeBillingStatus,
  type StripeBillingStorageAdapter,
  type StripeBillingSoftLimit,
  type StripeBillingTrial,
  type StripeBillingUsageProperties,
  type StripeBillingUsageOptions,
} from "./storage.js";

export type {
  StripeBillingCurrentChargeLine,
  StripeBillingCurrentChargesResult,
  StripeBillingCheckInput,
  StripeBillingCheckResult,
  StripeBillingMeterUsageInput,
  StripeBillingMeterUsageResult,
  StripeBillingUpcomingInvoiceLineKind,
  StripeBillingUpcomingInvoiceLineResult,
  StripeBillingUpcomingInvoiceResult,
  StripeBillingUpcomingInvoiceTotalsResult,
  StripeBillingReportUsageInput,
  StripeBillingReportUsageResult,
  StripeBillingUpgradeInput,
  StripeBillingUpgradeProrationBehavior,
  StripeBillingUpgradeResult,
  StripeBillingFeaturesResult,
  StripeBillingLimitsResult,
  StripeBillingStatusResult,
  StripeBillingUsageInput,
  StripeBillingUsageResult,
  StripeCatalogMeterPrice,
  StripeCatalogProduct,
  StripeClientAPI,
  StripeDefaultClientAPI,
  StripeCheckoutInput,
  StripeCheckoutResult,
  StripeCheckoutTrialBehavior,
  StripeIntegrationProduct,
  StripePortalInput,
  StripePortalResult,
  StripeSessionLineItemResult,
  StripeSessionQuery,
  StripeSessionResult,
  StripeWebhookResult,
} from "./client.js";
export {
  drizzleStorageAdapter,
  ormStorageAdapter,
  prismaStorageAdapter,
  sqliteStorageAdapter,
} from "./storage.js";
export type {
  StripeBillingFeatures,
  StripeBillingHookTools,
  StripeBillingHooks,
  StripeBillingLimits,
  StripeBillingMeter,
  StripeBillingMeterState,
  StripeBillingOptions,
  StripeBillingOwner,
  StripeBillingPlan,
  StripeBillingProduct,
  StripeBillingProductKind,
  StripeBillingSeatLimitSource,
  StripeBillingSeatsMode,
  StripeBillingSeatsOptions,
  StripeBillingSnapshot,
  StripeBillingStatus,
  StripeBillingStorageAdapter,
  StripeBillingTrial,
  StripeBillingUsageProperties,
  StripeBillingUsageOptions,
} from "./storage.js";

export interface StripeWebhookEvent extends FarmWebhookEvent<"stripe", string, unknown, unknown> {}

export type StripeWebhookConfig = FarmWebhookConfig<StripeWebhookEvent>;

interface StripeConstructedWebhookEvent {
  id: string;
  type: string;
  data: unknown;
  raw?: unknown;
}

export interface StripeIntegrationAdapter {
  createCheckoutSession(input: {
    product: StripeIntegrationProduct;
    quantity: number;
    lineItems?: Array<{
      product: StripeIntegrationProduct;
      quantity?: number;
    }>;
    customerId?: string;
    customerEmail?: string;
    successUrl: string;
    cancelUrl: string;
    trialDays?: number | null;
    metadata?: Record<string, string>;
    allowPromotionCodes?: boolean;
    automaticTax?: boolean;
  }): Promise<{ id: string; url: string }>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  updateSubscription?(input: {
    subscriptionId: string;
    product: StripeIntegrationProduct;
    lineItems: Array<{
      product: StripeIntegrationProduct;
      quantity?: number;
    }>;
    prorationBehavior?: StripeBillingUpgradeProrationBehavior;
  }): Promise<{
    customerId: string | null;
    subscriptionId: string;
    subscriptionStatus: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    lineItems: StripeSessionLineItemResult[];
  }>;
  reportUsage?(input: {
    customerId: string;
    key: string;
    meter: StripeBillingMeter;
    quantity: number;
    idempotencyKey: string;
    occurredAt: string;
    properties?: StripeBillingUsageProperties;
  }): Promise<{
    customerId: string;
    eventName: string;
    identifier: string;
    occurredAt: string;
  }>;
  previewUpcomingInvoice?(input: {
    customerId: string;
    subscriptionId: string;
    product: ResolvedStripeProduct | null;
  }): Promise<{
    currency: string | null;
    totals: StripeBillingUpcomingInvoiceTotalsResult;
    lines: StripeBillingUpcomingInvoiceLineResult[];
  }>;
  retrieveCheckoutSession(sessionId: string): Promise<StripeSessionResult>;
  constructWebhookEvent(input: {
    payload: string;
    signature: string | null;
    secret?: string;
  }): Promise<StripeConstructedWebhookEvent>;
}

function normalizeCheckoutTrialBehavior(value: unknown): StripeCheckoutTrialBehavior {
  switch (value) {
    case "none":
    case "require":
      return value;
    default:
      return "if_eligible";
  }
}

function normalizeProrationBehavior(value: unknown): StripeBillingUpgradeProrationBehavior {
  switch (value) {
    case "always_invoice":
    case "none":
      return value;
    default:
      return "create_prorations";
  }
}

function normalizeUsageProperties(value: unknown): StripeBillingUsageProperties | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const properties: StripeBillingUsageProperties = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      properties[key] = entry;
    }
  }

  return Object.keys(properties).length > 0 ? properties : undefined;
}

function resolveOccurredAt(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return new Date().toISOString();
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Stripe billing usage reporting requires a valid occurredAt timestamp.");
  }

  return date.toISOString();
}

/**
 * The primary path is passing a real Stripe SDK instance.
 * A custom adapter is still supported for local mocks and tests.
 */
export type StripeIntegrationInstance = Stripe | StripeIntegrationAdapter;

export interface StripeIntegrationInput {
  instance?: StripeIntegrationInstance;
  secretKey?: string;
  webhooks?: StripeWebhookConfig;
  webhookSecret?: string;
  appBaseUrl?: string;
  productsPath?: string;
  statusPath?: string;
  currentChargesPath?: string;
  featuresPath?: string;
  limitsPath?: string;
  usagePath?: string;
  meterUsagePath?: string;
  upcomingInvoicePath?: string;
  reportUsagePath?: string;
  checkPath?: string;
  checkoutPath?: string;
  upgradePath?: string;
  portalPath?: string;
  sessionPath?: string;
  webhookPath?: string;
  successPath?: string;
  cancelPath?: string;
  products?: StripeIntegrationProduct[];
  schema?: FarmIntegrationSchema;
  billing?: StripeBillingOptions;
  allowPromotionCodes?: boolean;
  automaticTax?: boolean;
  log?: FarmIntegrationLogger;
  onWebhook?: (
    event: StripeWebhookEvent,
    context: FarmIntegrationHandlerContext,
  ) => void | Promise<void>;
}

interface ResolvedStripeEnv {
  secretKey?: string;
  webhookSecret?: string;
  appBaseUrl?: string;
}

interface StripeAPIInput {
  productsPath?: string;
  statusPath?: string;
  currentChargesPath?: string;
  featuresPath?: string;
  limitsPath?: string;
  usagePath?: string;
  meterUsagePath?: string;
  upcomingInvoicePath?: string;
  reportUsagePath?: string;
  checkPath?: string;
  checkoutPath?: string;
  upgradePath?: string;
  portalPath?: string;
  sessionPath?: string;
}

function resolveStripeWebhooks(
  input: StripeIntegrationInput,
  env: ResolvedStripeEnv,
  defaultPath: string,
) {
  const configured = normalizeWebhookConfig<StripeWebhookEvent>({
    webhooks: input.webhooks,
    defaultName: "default",
    defaultPath,
    defaultSecret: env.webhookSecret,
  });

  if (configured.length > 0) {
    return configured;
  }

  return normalizeWebhookConfig<StripeWebhookEvent>({
    webhooks: {
      path: input.webhookPath ?? defaultPath,
      secret: input.webhookSecret ?? env.webhookSecret,
      onEvent: input.onWebhook
        ? async (event, context) => {
            await input.onWebhook?.(event, context.route);
          }
        : undefined,
    },
    defaultName: "default",
    defaultPath,
    defaultSecret: env.webhookSecret,
  });
}

type ResolvedStripeIntegrationPath<
  TPath extends string | undefined,
  TDefault extends string,
> = TPath extends string ? TPath : TDefault;

type StripeResolvedApiInput<TInput extends StripeIntegrationInput> = {
  readonly productsPath: ResolvedStripeIntegrationPath<TInput["productsPath"], "/billing/products">;
  readonly statusPath: ResolvedStripeIntegrationPath<TInput["statusPath"], "/billing/status">;
  readonly currentChargesPath: ResolvedStripeIntegrationPath<
    TInput["currentChargesPath"],
    "/billing/current-charges"
  >;
  readonly featuresPath: ResolvedStripeIntegrationPath<TInput["featuresPath"], "/billing/features">;
  readonly limitsPath: ResolvedStripeIntegrationPath<TInput["limitsPath"], "/billing/limits">;
  readonly usagePath: ResolvedStripeIntegrationPath<TInput["usagePath"], "/billing/usage">;
  readonly meterUsagePath: ResolvedStripeIntegrationPath<
    TInput["meterUsagePath"],
    "/billing/meter-usage"
  >;
  readonly upcomingInvoicePath: ResolvedStripeIntegrationPath<
    TInput["upcomingInvoicePath"],
    "/billing/upcoming-invoice"
  >;
  readonly reportUsagePath: ResolvedStripeIntegrationPath<
    TInput["reportUsagePath"],
    "/billing/report-usage"
  >;
  readonly checkPath: ResolvedStripeIntegrationPath<TInput["checkPath"], "/billing/check">;
  readonly checkoutPath: ResolvedStripeIntegrationPath<TInput["checkoutPath"], "/billing/checkout">;
  readonly upgradePath: ResolvedStripeIntegrationPath<TInput["upgradePath"], "/billing/upgrade">;
  readonly portalPath: ResolvedStripeIntegrationPath<TInput["portalPath"], "/billing/portal">;
  readonly sessionPath: ResolvedStripeIntegrationPath<TInput["sessionPath"], "/billing/session">;
};

type StripeDefaultPathInput = {
  productsPath?: undefined;
  statusPath?: undefined;
  currentChargesPath?: undefined;
  featuresPath?: undefined;
  limitsPath?: undefined;
  usagePath?: undefined;
  meterUsagePath?: undefined;
  upcomingInvoicePath?: undefined;
  reportUsagePath?: undefined;
  checkPath?: undefined;
  checkoutPath?: undefined;
  upgradePath?: undefined;
  portalPath?: undefined;
  sessionPath?: undefined;
};

type StripeIntegrationResult<TApi> = Omit<FarmIntegration, "api"> & {
  api: TApi;
};

type ResolvedStripeProduct = StripeIntegrationProduct & {
  id: string;
  kind: StripeBillingProductKind;
  public: boolean;
  planId: string | null;
  seatBilling: "line_item_quantity" | "included_plus_add_on";
};

type StripeSubscriptionLineItemInput = {
  product: StripeIntegrationProduct;
  quantity?: number;
};

type StripePreparedMeterContext = {
  snapshot: StripeBillingSnapshot;
  product: ResolvedStripeProduct | null;
  attachedPriceId: string | null;
  subscriptionStatus: StripeBillingStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  meterId: string | null;
  attached: boolean;
};

type StripeMeterUsageEvaluation = {
  currentPeriodUsed: number;
  includedLimit: number | null;
  softLimit: number | null;
  hardLimit: number | null;
  remainingIncluded: number | null;
  remainingHard: number | null;
  state: StripeBillingMeterState;
  warning: string | null;
};

type StripeUpcomingInvoicePreview = {
  currency: string | null;
  totals: StripeBillingUpcomingInvoiceTotalsResult;
  lines: StripeBillingUpcomingInvoiceLineResult[];
};

function toStripeCurrentChargeLineKind(
  kind: StripeBillingUpcomingInvoiceLineKind,
): StripeBillingCurrentChargeLine["kind"] {
  switch (kind) {
    case "metered":
      return "metered_usage";
    default:
      return kind;
  }
}

function toStripeCurrentChargesResult(input: {
  owner: StripeBillingOwner;
  snapshot: StripeBillingSnapshot;
  subscriptionStatus: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  preview: StripeUpcomingInvoicePreview;
  billing: StripeBillingOptions;
}): StripeBillingCurrentChargesResult {
  const currency = input.preview.currency ?? "usd";
  const baseSubscriptionAmount = input.preview.lines
    .filter((line) => line.kind === "base_subscription")
    .reduce((sum, line) => sum + (line.amount ?? 0), 0);

  return {
    owner: {
      kind: input.owner.kind,
      id: input.owner.id,
      email: input.owner.email,
    },
    planId: input.snapshot.planId,
    productId: input.snapshot.productId,
    customerId: input.snapshot.stripeCustomerId ?? "",
    subscriptionId: input.snapshot.stripeSubscriptionId,
    subscriptionStatus: input.subscriptionStatus,
    currency,
    currentPeriodStart: input.currentPeriodStart,
    currentPeriodEnd: input.currentPeriodEnd,
    baseSubscriptionAmount,
    pendingMeterChargeAmount: input.preview.totals.metered,
    estimatedTotalAmount: input.preview.totals.total,
    lineItems: input.preview.lines.map((line) => ({
      key: line.meterKey,
      kind: toStripeCurrentChargeLineKind(line.kind),
      label: line.description ?? line.kind,
      amount: line.amount,
      currency: line.currency ?? currency,
      quantity: line.quantity,
      includedUnits: line.meterKey
        ? getBillingLimitForKey(input.billing, input.snapshot.planId, input.snapshot, line.meterKey)
        : null,
      overageUnits: null,
      billedBuckets: null,
      billingUnits: null,
      unitAmountDecimal: null,
      periodStart: line.periodStart,
      periodEnd: line.periodEnd,
      meterKey: line.meterKey,
    })),
  };
}

type PendingStripeMeterProjectionEvent = {
  quantity: number;
  occurredAt: string;
  projectedCurrentPeriodUsed: number;
  expiresAt: number;
};

const pendingStripeMeterProjectionByPeriod = new Map<
  string,
  Map<string, PendingStripeMeterProjectionEvent>
>();

const PENDING_STRIPE_METER_PROJECTION_TTL_MS = 2 * 60 * 1000;

function createPendingStripeMeterProjectionKey(input: {
  customerId: string;
  key: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}): string {
  return [
    input.customerId,
    input.key,
    input.currentPeriodStart ?? "none",
    input.currentPeriodEnd ?? "none",
  ].join(":");
}

function prunePendingStripeMeterProjectionStore(
  periodKey: string,
  now = Date.now(),
): Map<string, PendingStripeMeterProjectionEvent> | null {
  const store = pendingStripeMeterProjectionByPeriod.get(periodKey);
  if (!store) {
    return null;
  }

  for (const [identifier, event] of store.entries()) {
    if (event.expiresAt <= now) {
      store.delete(identifier);
    }
  }

  if (store.size === 0) {
    pendingStripeMeterProjectionByPeriod.delete(periodKey);
    return null;
  }

  return store;
}

function getPendingStripeMeterProjectionEvent(input: {
  customerId: string;
  key: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  identifier: string;
}): PendingStripeMeterProjectionEvent | null {
  const periodKey = createPendingStripeMeterProjectionKey(input);
  const store = prunePendingStripeMeterProjectionStore(periodKey);
  return store?.get(input.identifier) ?? null;
}

function getPendingStripeMeterProjectedUsage(input: {
  customerId: string;
  key: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}): number | null {
  const periodKey = createPendingStripeMeterProjectionKey(input);
  const store = prunePendingStripeMeterProjectionStore(periodKey);
  if (!store) {
    return null;
  }

  let projectedCurrentPeriodUsed: number | null = null;
  for (const event of store.values()) {
    projectedCurrentPeriodUsed =
      projectedCurrentPeriodUsed == null
        ? event.projectedCurrentPeriodUsed
        : Math.max(projectedCurrentPeriodUsed, event.projectedCurrentPeriodUsed);
  }

  return projectedCurrentPeriodUsed;
}

function rememberPendingStripeMeterProjection(input: {
  customerId: string;
  key: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  identifier: string;
  quantity: number;
  occurredAt: string;
  projectedCurrentPeriodUsed: number;
}) {
  const periodKey = createPendingStripeMeterProjectionKey(input);
  const store =
    prunePendingStripeMeterProjectionStore(periodKey) ??
    new Map<string, PendingStripeMeterProjectionEvent>();

  store.set(input.identifier, {
    quantity: input.quantity,
    occurredAt: input.occurredAt,
    projectedCurrentPeriodUsed: input.projectedCurrentPeriodUsed,
    expiresAt: Date.now() + PENDING_STRIPE_METER_PROJECTION_TTL_MS,
  });

  pendingStripeMeterProjectionByPeriod.set(periodKey, store);
}

function resolveEffectiveStripeMeterCurrentPeriodUsed(input: {
  customerId: string;
  key: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  currentPeriodUsed: number;
}): number {
  const periodKey = createPendingStripeMeterProjectionKey(input);
  const pendingProjectedUsage = getPendingStripeMeterProjectedUsage(input);

  if (pendingProjectedUsage == null) {
    return input.currentPeriodUsed;
  }

  if (input.currentPeriodUsed >= pendingProjectedUsage) {
    pendingStripeMeterProjectionByPeriod.delete(periodKey);
    return input.currentPeriodUsed;
  }

  return Math.max(input.currentPeriodUsed, pendingProjectedUsage);
}

export const stripeSchema = {
  models: {
    billingAccount: {
      name: "billing_account",
      description:
        "Semantic billing snapshot for linking app owners to Stripe customers and subscriptions.",
      fields: {
        id: {
          type: "id",
          name: "id",
          primaryKey: true,
        },
        ownerId: {
          type: "string",
          name: "owner_id",
          required: true,
          index: true,
        },
        ownerKind: {
          type: "enum",
          name: "owner_kind",
          required: true,
          default: "user",
          values: ["user", "organization"],
          index: true,
        },
        stripeCustomerId: {
          type: "string",
          name: "stripe_customer_id",
          unique: true,
          nullable: true,
        },
        stripeSubscriptionId: {
          type: "string",
          name: "stripe_subscription_id",
          unique: true,
          nullable: true,
        },
        planId: {
          type: "string",
          name: "plan_id",
          required: true,
          default: "free",
        },
        productId: {
          type: "string",
          name: "product_id",
          nullable: true,
        },
        status: {
          type: "string",
          name: "status",
          required: true,
          default: "free",
        },
        currentPeriodEnd: {
          type: "datetime",
          name: "current_period_end",
          nullable: true,
        },
        cancelAtPeriodEnd: {
          type: "boolean",
          name: "cancel_at_period_end",
          required: true,
          default: false,
        },
        trialEndsAt: {
          type: "datetime",
          name: "trial_ends_at",
          nullable: true,
        },
        trialUsedAt: {
          type: "datetime",
          name: "trial_used_at",
          nullable: true,
        },
        seatQuantity: {
          type: "integer",
          name: "seat_quantity",
          nullable: true,
        },
        seatAllowanceOverride: {
          type: "integer",
          name: "seat_allowance_override",
          nullable: true,
        },
        createdAt: {
          type: "datetime",
          name: "created_at",
          required: true,
          default: "now",
        },
        updatedAt: {
          type: "datetime",
          name: "updated_at",
          required: true,
          default: "now",
          meta: {
            autoUpdate: true,
          },
        },
      },
      constraints: [
        {
          type: "unique",
          fields: ["ownerKind", "ownerId"],
          name: "billing_account_owner_unique",
        },
      ],
    },
  },
  meta: {
    category: "payment",
    integration: "stripe",
  },
} satisfies FarmIntegrationSchema;

function createStripeApi<const TInput extends StripeAPIInput = {}>(
  input: TInput = {} as TInput,
): StripeClientAPI<TInput> {
  return createStripeClientApi(input);
}

function resolveEnv(input: StripeIntegrationInput): ResolvedStripeEnv {
  return {
    secretKey: input.secretKey ?? process.env.STRIPE_SECRET_KEY ?? undefined,
    webhookSecret: input.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? undefined,
    appBaseUrl: input.appBaseUrl ?? process.env.APP_BASE_URL ?? undefined,
  };
}

function normalizeProducts(products: StripeIntegrationInput["products"]): ResolvedStripeProduct[] {
  const seen = new Set<string>();
  return (products || []).map((product) => {
    if (!product.id) {
      throw new Error("Stripe integration products require an id.");
    }

    if (seen.has(product.id)) {
      throw new Error(`Stripe integration product "${product.id}" is duplicated.`);
    }
    seen.add(product.id);

    if (!product.name && !product.priceId && !product.lookupKey) {
      throw new Error(`Stripe integration product "${product.id}" requires a name.`);
    }

    if (!product.priceId && !product.lookupKey) {
      if (!product.currency) {
        throw new Error(
          `Stripe integration product "${product.id}" requires a currency when priceId and lookupKey are not provided.`,
        );
      }

      const unitAmount = product.unitAmount;
      if (typeof unitAmount !== "number" || !Number.isInteger(unitAmount) || unitAmount <= 0) {
        throw new Error(
          `Stripe integration product "${product.id}" requires a positive integer unitAmount when priceId and lookupKey are not provided.`,
        );
      }
    } else if (
      product.unitAmount != null &&
      (!Number.isInteger(product.unitAmount) || product.unitAmount <= 0)
    ) {
      throw new Error(`Stripe integration product "${product.id}" has an invalid unitAmount.`);
    }

    if (
      product.intervalCount != null &&
      (!Number.isInteger(product.intervalCount) || product.intervalCount <= 0)
    ) {
      throw new Error(`Stripe integration product "${product.id}" has an invalid intervalCount.`);
    }

    const mode = product.mode ?? "payment";

    return {
      ...product,
      kind: mode === "subscription" ? "subscription" : "one_time",
      public: true,
      planId: product.id,
      seatBilling: product.seatBilling ?? "line_item_quantity",
      mode,
      quantity: product.quantity ?? 1,
      interval: product.interval ?? (product.mode === "subscription" ? "month" : undefined),
      intervalCount: mode === "subscription" ? (product.intervalCount ?? 1) : product.intervalCount,
    } satisfies ResolvedStripeProduct;
  });
}

function normalizeBillingProducts(
  products: StripeBillingOptions["products"],
): ResolvedStripeProduct[] {
  if (!products) {
    return [];
  }

  const seen = new Set<string>();

  return Object.entries(products).map(([id, product]) => {
    const priceId = product.stripe?.priceId ?? product.priceId;
    const seatPriceId = product.stripe?.seatPriceId ?? product.seatPriceId;
    const meterPriceIds = product.stripe?.meterPriceIds ?? product.meterPriceIds;
    const lookupKey = product.stripe?.lookupKey ?? product.lookupKey;

    if (seen.has(id)) {
      throw new Error(`Stripe billing product "${id}" is duplicated.`);
    }
    seen.add(id);

    if (!product.name && !priceId && !lookupKey) {
      throw new Error(`Stripe billing product "${id}" requires a name.`);
    }

    if (!priceId && !lookupKey) {
      if (!product.currency) {
        throw new Error(
          `Stripe billing product "${id}" requires a currency when priceId and lookupKey are not provided.`,
        );
      }

      if (
        typeof product.unitAmount !== "number" ||
        !Number.isInteger(product.unitAmount) ||
        product.unitAmount <= 0
      ) {
        throw new Error(
          `Stripe billing product "${id}" requires a positive integer unitAmount when priceId and lookupKey are not provided.`,
        );
      }
    }

    if (
      product.intervalCount != null &&
      (!Number.isInteger(product.intervalCount) || product.intervalCount <= 0)
    ) {
      throw new Error(`Stripe billing product "${id}" has an invalid intervalCount.`);
    }

    const mode = product.kind === "subscription" ? "subscription" : "payment";

    return {
      id,
      name: product.name,
      description: product.description,
      priceId,
      seatPriceId,
      meterPriceIds,
      lookupKey,
      currency: product.currency,
      unitAmount: product.unitAmount,
      kind: product.kind,
      public: product.public ?? true,
      planId: product.planId ?? null,
      seatBilling: product.seatBilling ?? "line_item_quantity",
      mode,
      interval: product.kind === "subscription" ? (product.interval ?? "month") : product.interval,
      intervalCount:
        product.kind === "subscription" ? (product.intervalCount ?? 1) : product.intervalCount,
      quantity: product.quantity ?? 1,
      imageUrl: product.imageUrl,
      metadata: product.metadata,
    } satisfies ResolvedStripeProduct;
  });
}

async function resolveStripePriceReference(
  stripe: Stripe,
  product: StripeIntegrationProduct,
): Promise<{ priceId: string; mode: "payment" | "subscription" } | null> {
  const resolved = await resolveStripePriceWithProduct(stripe, product);
  if (!resolved) {
    return null;
  }
  const price = resolved.price;

  const resolvedMode: "payment" | "subscription" =
    price.type === "recurring" || price.recurring ? "subscription" : "payment";

  if (product.mode && product.mode !== resolvedMode) {
    throw new Error(
      `Stripe integration product "${product.id}" declares mode "${product.mode}" but price "${price.id}" is "${resolvedMode}".`,
    );
  }

  return {
    priceId: price.id,
    mode: product.mode ?? resolvedMode,
  };
}

async function resolveCatalogProducts(
  stripe: Stripe | null,
  products: readonly ResolvedStripeProduct[],
  billing: StripeBillingOptions | undefined,
): Promise<StripeResolvedCatalogProduct[]> {
  return await Promise.all(
    products.map(async (product) => {
      const trialDays =
        product.planId && billing?.plans?.[product.planId]?.trial
          ? billing.plans[product.planId]!.trial!.days
          : null;
      const seatPrice =
        stripe && product.seatPriceId ? await stripe.prices.retrieve(product.seatPriceId) : null;
      const resolvedSeatPrice =
        seatPrice && !("deleted" in seatPrice && seatPrice.deleted) ? seatPrice : null;
      const meterPrices: StripeCatalogMeterPrice[] =
        stripe && product.meterPriceIds
          ? (
              await Promise.all(
                Object.entries(product.meterPriceIds).map(async ([key, priceId]) => {
                  const result = await stripe.prices.retrieve(priceId, {
                    expand: ["product"],
                  });

                  if ("deleted" in result && result.deleted) {
                    return null;
                  }

                  const meter = billing?.meters?.[key] ?? null;
                  const tiers =
                    result.billing_scheme === "tiered" && Array.isArray(result.tiers)
                      ? result.tiers
                      : [];
                  const includedTier = tiers[0] ?? null;
                  const overageTier = tiers[1] ?? null;
                  const includedUnits =
                    includedTier && typeof includedTier.up_to === "number"
                      ? includedTier.up_to
                      : null;
                  const unitAmountDecimal =
                    overageTier?.unit_amount_decimal ??
                    result.unit_amount_decimal ??
                    (typeof result.unit_amount === "number" ? String(result.unit_amount) : null);
                  const generatedSummary =
                    includedUnits !== null && unitAmountDecimal
                      ? `Includes first ${includedUnits.toLocaleString()} ${meter?.unit ?? "units"}, then ${formatCurrencyFromMinorDecimal(unitAmountDecimal, result.currency)} per ${meter?.unit ?? "unit"}.`
                      : unitAmountDecimal
                        ? `${formatCurrencyFromMinorDecimal(unitAmountDecimal, result.currency)} per ${meter?.unit ?? "unit"}.`
                        : null;
                  const summary =
                    result.metadata.rateSummary || result.nickname || generatedSummary;

                  const meterPrice: StripeCatalogMeterPrice = {
                    key,
                    eventName: meter?.eventName ?? key,
                    unit: meter?.unit ?? null,
                    priceId: result.id,
                    currency: result.currency,
                    billingScheme: result.billing_scheme ?? null,
                    tiersMode: result.tiers_mode ?? null,
                    unitAmount: result.unit_amount ?? null,
                    unitAmountDecimal: result.unit_amount_decimal ?? null,
                    summary,
                  };

                  return meterPrice;
                }),
              )
            ).filter((item) => item !== null)
          : [];

      if (!stripe) {
        return {
          id: product.id,
          name: product.name ?? product.id,
          description: product.description ?? null,
          kind: product.kind,
          planId: product.planId,
          trialDays,
          public: product.public,
          currency: product.currency ?? null,
          unitAmount: product.unitAmount ?? null,
          mode: product.mode ?? "payment",
          interval: product.interval ?? null,
          intervalCount: product.intervalCount ?? null,
          quantity: product.quantity ?? 1,
          seatBilling: product.seatBilling ?? "line_item_quantity",
          hasSeatPrice: Boolean(product.seatPriceId),
          seatUnitAmount: null,
          seatCurrency: null,
          meterPrices: [],
          priceId: product.priceId ?? null,
          productId: null,
          lookupKey: product.lookupKey ?? null,
          metadata: product.metadata ?? {},
        } satisfies StripeResolvedCatalogProduct;
      }

      const resolved = await resolveStripePriceWithProduct(stripe, product);
      const price = resolved?.price ?? null;
      const stripeProduct = resolved?.product ?? null;

      return {
        id: product.id,
        name: product.name ?? stripeProduct?.name ?? product.id,
        description: product.description ?? stripeProduct?.description ?? null,
        kind: product.kind,
        planId: product.planId,
        trialDays,
        public: product.public,
        currency: price?.currency ?? product.currency ?? null,
        unitAmount: price?.unit_amount ?? product.unitAmount ?? null,
        mode:
          product.mode ??
          (price?.type === "recurring" || price?.recurring ? "subscription" : "payment"),
        interval:
          product.interval ??
          (price?.recurring?.interval as "day" | "week" | "month" | "year" | undefined) ??
          null,
        intervalCount: product.intervalCount ?? price?.recurring?.interval_count ?? null,
        quantity: product.quantity ?? 1,
        seatBilling: product.seatBilling ?? "line_item_quantity",
        hasSeatPrice: Boolean(product.seatPriceId),
        seatUnitAmount: resolvedSeatPrice?.unit_amount ?? null,
        seatCurrency: resolvedSeatPrice?.currency ?? null,
        meterPrices,
        priceId: price?.id ?? product.priceId ?? null,
        productId: stripeProduct?.id ?? null,
        lookupKey: price?.lookup_key ?? product.lookupKey ?? null,
        metadata: {
          ...stripeProduct?.metadata,
          ...price?.metadata,
          ...product.metadata,
        },
      } satisfies StripeResolvedCatalogProduct;
    }),
  );
}

function resolvePath(path: string | undefined, label: string, fallback: string): string {
  return resolveAppPath(path, label) ?? fallback;
}

function resolveQuantity(rawQuantity: number | undefined, fallback: number): number {
  const quantity = rawQuantity ?? fallback;
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Stripe checkout quantity must be a positive integer.");
  }
  return quantity;
}

function resolveMeterLineItems(
  product: ResolvedStripeProduct,
  billing: StripeBillingOptions | undefined,
): StripeSubscriptionLineItemInput[] {
  if (!product.meterPriceIds) {
    return [];
  }

  return Object.entries(product.meterPriceIds).map(([key, priceId]) => {
    const meter = getBillingMeter(billing, key);

    return {
      product: {
        id: `${product.id}:meter:${key}`,
        priceId,
        mode: "subscription",
        metadata: {
          meterKey: key,
          meterEventName: meter?.eventName ?? key,
          meterForProductId: product.id,
        },
      },
    };
  });
}

function resolveCheckoutLineItems(
  product: ResolvedStripeProduct,
  quantity: number,
  billing: StripeBillingOptions | undefined,
  planId: string,
): StripeSubscriptionLineItemInput[] {
  const meterLineItems = resolveMeterLineItems(product, billing);

  if (product.seatBilling !== "included_plus_add_on") {
    return [
      {
        product,
        quantity,
      },
      ...meterLineItems,
    ];
  }

  const includedSeats = getConfiguredBillingLimits(billing, planId).seats;
  if (typeof includedSeats !== "number" || !Number.isInteger(includedSeats) || includedSeats <= 0) {
    throw new Error(
      `Stripe billing product "${product.id}" requires a positive integer plan seat limit when seatBilling="included_plus_add_on".`,
    );
  }

  if (quantity < includedSeats) {
    throw new Error(
      `Stripe checkout quantity for "${product.id}" must be at least ${includedSeats}.`,
    );
  }

  const lineItems: StripeSubscriptionLineItemInput[] = [
    {
      product,
      quantity: 1,
    },
  ];

  const extraSeats = quantity - includedSeats;
  if (extraSeats <= 0) {
    return [...lineItems, ...meterLineItems];
  }

  if (!product.seatPriceId) {
    throw new Error(
      `Stripe billing product "${product.id}" requires seatPriceId before checkout can add seats above the included ${includedSeats}.`,
    );
  }

  lineItems.push({
    product: {
      id: `${product.id}:seat-addon`,
      priceId: product.seatPriceId,
      mode: "subscription",
      metadata: {
        seatAddOnForProductId: product.id,
      },
    },
    quantity: extraSeats,
  });

  return [...lineItems, ...meterLineItems];
}

function resolveAbsoluteDestination(
  pathOrUrl: string,
  request: Request,
  configuredBaseUrl: string | undefined,
  params?: Record<string, string | null | undefined>,
) {
  const targetUrl = toAbsoluteUrl(pathOrUrl, request, configuredBaseUrl);
  return params ? withSearchParams(targetUrl, params).toString() : targetUrl.toString();
}

function resolveCheckoutSuccessUrl(
  pathOrUrl: string,
  request: Request,
  configuredBaseUrl: string | undefined,
) {
  const targetUrl = resolveAbsoluteDestination(pathOrUrl, request, configuredBaseUrl, {
    session_id: "{CHECKOUT_SESSION_ID}",
  });

  return targetUrl.replace(encodeURIComponent("{CHECKOUT_SESSION_ID}"), "{CHECKOUT_SESSION_ID}");
}

function normalizeStripeSessionResult(input: {
  id: string;
  status?: string | null;
  paymentStatus?: string | null;
  mode?: string | null;
  customerId?: string | null;
  customerEmail?: string | null;
  subscriptionId?: string | null;
  subscriptionStatus?: string | null;
  currentPeriodEnd?: string | null;
  trialEndsAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  amountSubtotal?: number | null;
  amountTotal?: number | null;
  currency?: string | null;
  metadata?: Record<string, string>;
  lineItems?: StripeSessionLineItemResult[];
}): StripeSessionResult {
  return {
    id: input.id,
    status: input.status ?? null,
    paymentStatus: input.paymentStatus ?? null,
    mode: input.mode === "payment" || input.mode === "subscription" ? input.mode : null,
    customerId: input.customerId ?? null,
    customerEmail: input.customerEmail ?? null,
    subscriptionId: input.subscriptionId ?? null,
    subscriptionStatus: input.subscriptionStatus ?? null,
    currentPeriodEnd: input.currentPeriodEnd ?? null,
    trialEndsAt: input.trialEndsAt ?? null,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    amountSubtotal: input.amountSubtotal ?? null,
    amountTotal: input.amountTotal ?? null,
    currency: input.currency ?? null,
    metadata: input.metadata ?? {},
    lineItems: input.lineItems ?? [],
  };
}

function normalizeBillingStatus(
  value: string | null | undefined,
  fallback: StripeBillingStatus = "active",
): StripeBillingStatus {
  switch (value) {
    case "trialing":
    case "active":
    case "past_due":
    case "canceled":
    case "unpaid":
    case "incomplete":
      return value;
    case "paid":
      return "active";
    default:
      return fallback;
  }
}

function formatCurrencyFromMinorDecimal(
  value: string,
  currency: string | null | undefined,
): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
    maximumFractionDigits: parsed % 100 === 0 ? 0 : 6,
  }).format(parsed / 100);
}

function serializeBillingSnapshot(
  snapshot: StripeBillingSnapshot | null,
  billing: StripeBillingOptions | undefined,
  features: StripeBillingFeatures = {},
  limits: StripeBillingLimits = {},
  entitlements: Record<string, unknown> = {},
): StripeBillingStatusResult {
  const planId = snapshot?.planId ?? "free";
  const seatLimit = getBillingSeatLimit(billing, planId, snapshot);

  return {
    owner: snapshot?.owner ?? null,
    planId,
    productId: snapshot?.productId ?? null,
    status: snapshot?.status ?? "free",
    stripeCustomerId: snapshot?.stripeCustomerId ?? null,
    stripeSubscriptionId: snapshot?.stripeSubscriptionId ?? null,
    currentPeriodEnd: snapshot?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: snapshot?.cancelAtPeriodEnd ?? false,
    trialEndsAt: snapshot?.trialEndsAt?.toISOString() ?? null,
    trialUsedAt: snapshot?.trialUsedAt?.toISOString() ?? null,
    seatMode: getBillingSeatsMode(billing),
    seatQuantity: snapshot?.seatQuantity ?? null,
    seatAllowanceOverride: snapshot?.seatAllowanceOverride ?? null,
    seatLimitSource: seatLimit.source,
    features,
    limits,
    entitlements,
  };
}

type StripeResolvedCatalogProduct = StripeCatalogProduct;

async function resolveStripePriceWithProduct(
  stripe: Stripe,
  product: StripeIntegrationProduct,
): Promise<{
  price: Stripe.Price;
  product: Stripe.Product | null;
} | null> {
  let price: Stripe.Price | null = null;

  if (product.lookupKey) {
    const result = await stripe.prices.list({
      lookup_keys: [product.lookupKey],
      active: true,
      limit: 1,
    });

    price = result.data[0] ?? null;
    if (!price) {
      throw new Error(
        `Stripe integration product "${product.id}" could not resolve lookupKey "${product.lookupKey}".`,
      );
    }
  } else if (product.priceId) {
    const result = await stripe.prices.retrieve(product.priceId);
    if ("deleted" in result && result.deleted) {
      throw new Error(
        `Stripe integration product "${product.id}" references deleted price "${product.priceId}".`,
      );
    }
    price = result;
  }

  if (!price) {
    return null;
  }

  if (typeof price.product !== "string") {
    return {
      price,
      product: "deleted" in price.product && price.product.deleted ? null : price.product,
    };
  }

  const stripeProduct = await stripe.products.retrieve(price.product);
  return {
    price,
    product: "deleted" in stripeProduct && stripeProduct.deleted ? null : stripeProduct,
  };
}

function isStripeSdkInstance(value: StripeIntegrationInstance): value is Stripe {
  return (
    !!value &&
    typeof value === "object" &&
    "checkout" in value &&
    "billingPortal" in value &&
    "webhooks" in value
  );
}

function getStripePriceProductId(price: Stripe.Price | null | undefined): string | null {
  if (!price || typeof price.product === "string") {
    return null;
  }

  return "deleted" in price.product && price.product.deleted
    ? null
    : (price.product.metadata?.productId ?? null);
}

function findSubscriptionItemForProduct(
  subscription: Stripe.Subscription,
  product: StripeIntegrationProduct,
  resolvedPriceId: string | null,
): Stripe.SubscriptionItem | null {
  for (const item of subscription.items.data) {
    if (resolvedPriceId && item.price.id === resolvedPriceId) {
      return item;
    }

    if (getStripePriceProductId(item.price) === product.id) {
      return item;
    }
  }

  return null;
}

function normalizeStripeSubscriptionResult(subscription: Stripe.Subscription): {
  customerId: string | null;
  subscriptionId: string;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  lineItems: StripeSessionLineItemResult[];
} {
  return {
    customerId:
      typeof subscription.customer === "string"
        ? subscription.customer
        : (subscription.customer?.id ?? null),
    subscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
    currentPeriodEnd: subscription.items.data[0]?.current_period_end
      ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
      : null,
    trialEndsAt:
      typeof subscription.trial_end === "number"
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    lineItems: subscription.items.data.map((item) => ({
      description:
        typeof item.price.product === "string"
          ? null
          : "deleted" in item.price.product && item.price.product.deleted
            ? null
            : (item.price.product.name ?? null),
      quantity: item.quantity ?? null,
      amountSubtotal: null,
      amountTotal: null,
      currency: item.price.currency ?? null,
      priceId: item.price.id ?? null,
      productId: getStripePriceProductId(item.price),
    })),
  };
}

function getStripeInvoiceLinePriceId(line: Stripe.InvoiceLineItem): string | null {
  const pricing = (
    line as Stripe.InvoiceLineItem & {
      pricing?: {
        type?: string;
        price_details?: {
          price?: string | null;
        } | null;
      } | null;
    }
  ).pricing;
  if (pricing?.type === "price_details" && typeof pricing.price_details?.price === "string") {
    return pricing.price_details.price;
  }

  const legacyPrice = (
    line as Stripe.InvoiceLineItem & {
      price?: {
        id?: string | null;
      } | null;
    }
  ).price;

  return typeof legacyPrice?.id === "string" ? legacyPrice.id : null;
}

function getStripeInvoiceLineStripeProductId(line: Stripe.InvoiceLineItem): string | null {
  const pricing = (
    line as Stripe.InvoiceLineItem & {
      pricing?: {
        type?: string;
        price_details?: {
          product?: string | null;
        } | null;
      } | null;
    }
  ).pricing;
  if (pricing?.type === "price_details" && typeof pricing.price_details?.product === "string") {
    return pricing.price_details.product;
  }

  return null;
}

function isStripeInvoiceLineProration(line: Stripe.InvoiceLineItem): boolean {
  const parent = (
    line as Stripe.InvoiceLineItem & {
      parent?: {
        subscription_item_details?: {
          proration?: boolean | null;
        } | null;
      } | null;
    }
  ).parent;

  return parent?.subscription_item_details?.proration === true;
}

function resolveStripeUpcomingInvoiceLineKind(input: {
  line: Stripe.InvoiceLineItem;
  basePriceId: string | null;
  seatPriceId: string | null | undefined;
  meterKeyByPriceId: Map<string, string>;
}): {
  kind: StripeBillingUpcomingInvoiceLineKind;
  meterKey: string | null;
} {
  const { line, basePriceId, seatPriceId, meterKeyByPriceId } = input;
  const priceId = getStripeInvoiceLinePriceId(line);
  const meterKey = priceId ? (meterKeyByPriceId.get(priceId) ?? null) : null;

  if (isStripeInvoiceLineProration(line)) {
    return {
      kind: "proration",
      meterKey,
    };
  }

  if (meterKey) {
    return {
      kind: "metered",
      meterKey,
    };
  }

  if (priceId && seatPriceId && priceId === seatPriceId) {
    return {
      kind: "seat_add_on",
      meterKey: null,
    };
  }

  if (priceId && basePriceId && priceId === basePriceId) {
    return {
      kind: "base_subscription",
      meterKey: null,
    };
  }

  return {
    kind: "other",
    meterKey: null,
  };
}

async function createStripeUpcomingInvoicePreviewFromSdk(input: {
  stripe: Stripe;
  customerId: string;
  subscriptionId: string;
  product: ResolvedStripeProduct | null;
}): Promise<StripeUpcomingInvoicePreview> {
  const basePriceId = input.product
    ? ((await resolveStripePriceReference(input.stripe, input.product))?.priceId ?? null)
    : null;
  const meterKeyByPriceId = new Map<string, string>(
    Object.entries(input.product?.meterPriceIds ?? {}).flatMap(([key, priceId]) =>
      typeof priceId === "string" && priceId ? [[priceId, key] as const] : [],
    ),
  );
  const preview = await input.stripe.invoices.createPreview({
    customer: input.customerId,
    subscription: input.subscriptionId,
  });
  const totals: StripeBillingUpcomingInvoiceTotalsResult = {
    recurring: 0,
    prorations: 0,
    metered: 0,
    other: 0,
    total: typeof preview.total === "number" ? preview.total : 0,
  };

  const lines = preview.lines.data.map((line) => {
    const { kind, meterKey } = resolveStripeUpcomingInvoiceLineKind({
      line,
      basePriceId,
      seatPriceId: input.product?.seatPriceId,
      meterKeyByPriceId,
    });

    switch (kind) {
      case "base_subscription":
      case "seat_add_on":
        totals.recurring += line.amount;
        break;
      case "proration":
        totals.prorations += line.amount;
        break;
      case "metered":
        totals.metered += line.amount;
        break;
      default:
        totals.other += line.amount;
        break;
    }

    return {
      description: line.description ?? null,
      kind,
      quantity: line.quantity ?? null,
      amount: line.amount ?? null,
      currency: line.currency ?? preview.currency ?? null,
      periodStart:
        typeof line.period?.start === "number"
          ? new Date(line.period.start * 1000).toISOString()
          : null,
      periodEnd:
        typeof line.period?.end === "number"
          ? new Date(line.period.end * 1000).toISOString()
          : null,
      priceId: getStripeInvoiceLinePriceId(line),
      stripeProductId: getStripeInvoiceLineStripeProductId(line),
      meterKey,
    } satisfies StripeBillingUpcomingInvoiceLineResult;
  });

  return {
    currency: preview.currency ?? null,
    totals,
    lines,
  };
}

function createStripeAdapterFromSdk(stripe: Stripe): StripeIntegrationAdapter {
  return {
    async createCheckoutSession(input) {
      const checkoutLineItems = input.lineItems?.length
        ? input.lineItems
        : [
            {
              product: input.product,
              quantity: input.quantity,
            },
          ];
      const resolvedLineItems = await Promise.all(
        checkoutLineItems.map(async (lineItem) => {
          const resolvedPrice = await resolveStripePriceReference(stripe, lineItem.product);
          const mode = resolvedPrice?.mode ?? lineItem.product.mode ?? "payment";

          return {
            mode,
            lineItem: resolvedPrice
              ? {
                  price: resolvedPrice.priceId,
                  ...(typeof lineItem.quantity === "number"
                    ? {
                        quantity: lineItem.quantity,
                      }
                    : {}),
                }
              : {
                  price_data: {
                    currency: lineItem.product.currency!,
                    unit_amount: lineItem.product.unitAmount!,
                    recurring:
                      mode === "subscription"
                        ? {
                            interval: lineItem.product.interval ?? "month",
                            interval_count: lineItem.product.intervalCount ?? 1,
                          }
                        : undefined,
                    product_data: {
                      name: lineItem.product.name ?? lineItem.product.id,
                      description: lineItem.product.description,
                      images: lineItem.product.imageUrl ? [lineItem.product.imageUrl] : undefined,
                      metadata: {
                        productId: lineItem.product.id,
                        ...lineItem.product.metadata,
                      },
                    },
                  },
                  ...(typeof lineItem.quantity === "number"
                    ? {
                        quantity: lineItem.quantity,
                      }
                    : {}),
                },
          };
        }),
      );
      const mode = resolvedLineItems[0]?.mode ?? input.product.mode ?? "payment";
      const session = await stripe.checkout.sessions.create({
        mode,
        customer: input.customerId,
        customer_email: input.customerId ? undefined : input.customerEmail,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        allow_promotion_codes: input.allowPromotionCodes,
        automatic_tax: input.automaticTax ? { enabled: true } : undefined,
        customer_creation: mode === "payment" && !input.customerId ? "always" : undefined,
        client_reference_id: input.product.id,
        metadata: {
          productId: input.product.id,
          ...input.product.metadata,
          ...input.metadata,
        },
        subscription_data:
          mode === "subscription" && input.trialDays && input.trialDays > 0
            ? {
                trial_period_days: input.trialDays,
              }
            : undefined,
        line_items: resolvedLineItems.map((entry) => entry.lineItem),
      });

      if (!session.url) {
        throw new Error("Stripe did not return a Checkout redirect URL.");
      }

      return {
        id: session.id,
        url: session.url,
      };
    },

    async createPortalSession(input) {
      const session = await stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      });

      return {
        url: session.url,
      };
    },

    async updateSubscription(input) {
      const subscription = await stripe.subscriptions.retrieve(input.subscriptionId, {
        expand: ["items.data.price.product"],
      });

      if ("deleted" in subscription && subscription.deleted) {
        throw new Error(`Stripe subscription "${input.subscriptionId}" no longer exists.`);
      }

      const itemUpdates: Stripe.SubscriptionUpdateParams.Item[] = [];
      const matchedItemIds = new Set<string>();
      const relevantProductPriceIds = new Set<string>(
        [input.product.seatPriceId, ...Object.values(input.product.meterPriceIds ?? {})].flatMap(
          (value) => (typeof value === "string" && value ? [value] : []),
        ),
      );

      for (const lineItem of input.lineItems) {
        const resolvedPrice = await resolveStripePriceReference(stripe, lineItem.product);
        const existingItem = findSubscriptionItemForProduct(
          subscription,
          lineItem.product,
          resolvedPrice?.priceId ?? null,
        );

        if (existingItem) {
          matchedItemIds.add(existingItem.id);
          if (typeof lineItem.quantity === "number") {
            itemUpdates.push({
              id: existingItem.id,
              quantity: lineItem.quantity,
            });
          }
          continue;
        }

        if (!resolvedPrice?.priceId) {
          throw new Error(
            `Stripe billing product "${lineItem.product.id}" requires a saved price before it can be added to an existing subscription.`,
          );
        }

        itemUpdates.push({
          price: resolvedPrice.priceId,
          ...(typeof lineItem.quantity === "number"
            ? {
                quantity: lineItem.quantity,
              }
            : {}),
        });
      }

      for (const item of subscription.items.data) {
        if (matchedItemIds.has(item.id)) {
          continue;
        }

        const itemProductId = getStripePriceProductId(item.price);
        if (itemProductId !== input.product.id && !relevantProductPriceIds.has(item.price.id)) {
          continue;
        }

        itemUpdates.push({
          id: item.id,
          deleted: true,
        });
      }

      const updated = await stripe.subscriptions.update(input.subscriptionId, {
        items: itemUpdates,
        proration_behavior: input.prorationBehavior ?? "create_prorations",
        expand: ["items.data.price.product"],
      });

      return normalizeStripeSubscriptionResult(updated);
    },

    async reportUsage(input) {
      const occurredAtDate = new Date(input.occurredAt);
      const timestamp = Math.floor(occurredAtDate.getTime() / 1000);
      const payload: Record<string, string> = {
        stripe_customer_id: input.customerId,
        value: String(input.quantity),
      };

      for (const [key, value] of Object.entries(input.properties ?? {})) {
        payload[key] = String(value);
      }

      const event = await stripe.billing.meterEvents.create({
        event_name: input.meter.eventName,
        identifier: input.idempotencyKey,
        timestamp,
        payload,
      });

      return {
        customerId: input.customerId,
        eventName: event.event_name,
        identifier: event.identifier,
        occurredAt: new Date(event.timestamp * 1000).toISOString(),
      };
    },

    async previewUpcomingInvoice(input) {
      return createStripeUpcomingInvoicePreviewFromSdk({
        stripe,
        customerId: input.customerId,
        subscriptionId: input.subscriptionId,
        product: input.product,
      });
    },

    async retrieveCheckoutSession(sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, {
        limit: 20,
      });
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : (session.subscription?.id ?? null);
      const subscription = subscriptionId
        ? await stripe.subscriptions.retrieve(subscriptionId)
        : null;
      const normalizedSubscription =
        subscription && !("deleted" in subscription && subscription.deleted)
          ? normalizeStripeSubscriptionResult(subscription)
          : null;

      return normalizeStripeSessionResult({
        id: session.id,
        status: session.status,
        paymentStatus: session.payment_status,
        mode: session.mode,
        customerId:
          typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null),
        customerEmail: session.customer_details?.email ?? session.customer_email ?? null,
        subscriptionId,
        subscriptionStatus: normalizedSubscription?.subscriptionStatus ?? null,
        currentPeriodEnd: normalizedSubscription?.currentPeriodEnd ?? null,
        trialEndsAt: normalizedSubscription?.trialEndsAt ?? null,
        cancelAtPeriodEnd: normalizedSubscription?.cancelAtPeriodEnd ?? false,
        amountSubtotal: session.amount_subtotal,
        amountTotal: session.amount_total,
        currency: session.currency,
        metadata: session.metadata || {},
        lineItems: lineItems.data.map((item) => ({
          description: item.description ?? null,
          quantity: item.quantity,
          amountSubtotal: item.amount_subtotal,
          amountTotal: item.amount_total,
          currency: item.currency,
          priceId: item.price?.id ?? null,
          productId:
            item.price?.product && typeof item.price.product === "object"
              ? "deleted" in item.price.product && item.price.product.deleted
                ? null
                : (item.price.product.metadata?.productId ?? null)
              : null,
        })),
      });
    },

    async constructWebhookEvent(input) {
      if (!input.secret) {
        throw new Error("Stripe webhook secret is required to verify webhook events.");
      }

      const event = stripe.webhooks.constructEvent(
        input.payload,
        input.signature || "",
        input.secret,
      );

      return {
        id: event.id,
        type: event.type,
        data: event.data.object,
        raw: event,
      };
    },
  };
}

function resolveStripeInstance(
  input: StripeIntegrationInput,
  env: ResolvedStripeEnv,
): StripeIntegrationAdapter {
  const candidate = input.instance || (env.secretKey ? new Stripe(env.secretKey) : undefined);

  if (!candidate) {
    throw new Error("Stripe integration requires a Stripe SDK instance or STRIPE_SECRET_KEY.");
  }

  return isStripeSdkInstance(candidate) ? createStripeAdapterFromSdk(candidate) : candidate;
}

function getProduct(
  products: readonly ResolvedStripeProduct[],
  productId: string,
): ResolvedStripeProduct {
  const product = products.find((item) => item.id === productId);
  if (!product) {
    throw new Error(`Unknown Stripe product "${productId}".`);
  }
  return product;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    if (value && typeof value === "object") {
      return value as Record<string, unknown>;
    }
  } catch {
    // Keep request parsing errors as empty input and validate below.
  }

  return {};
}

function getBillingPlan(
  billing: StripeBillingOptions | undefined,
  planId: string,
): StripeBillingPlan | undefined {
  return billing?.plans?.[planId];
}

function getBillingTrial(
  billing: StripeBillingOptions | undefined,
  planId: string,
): StripeBillingTrial | undefined {
  return getBillingPlan(billing, planId)?.trial;
}

function getBillingSeatsMode(billing: StripeBillingOptions | undefined): StripeBillingSeatsMode {
  return billing?.seats?.mode === "subscription_quantity" ? "subscription_quantity" : "plan_limit";
}

function normalizeBillingFeatures(value: unknown): StripeBillingFeatures {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
    ),
  );
}

function normalizeBillingLimits(value: unknown): StripeBillingLimits {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
}

function getBillingFeatures(
  billing: StripeBillingOptions | undefined,
  planId: string,
): StripeBillingFeatures {
  const plan = getBillingPlan(billing, planId);
  if (plan?.features) {
    return plan.features;
  }

  const legacyFeatures =
    plan?.entitlements && typeof plan.entitlements === "object"
      ? (plan.entitlements as Record<string, unknown>).features
      : undefined;

  return normalizeBillingFeatures(legacyFeatures);
}

function getConfiguredBillingLimits(
  billing: StripeBillingOptions | undefined,
  planId: string,
): StripeBillingLimits {
  const plan = getBillingPlan(billing, planId);
  if (plan?.limits) {
    return plan.limits;
  }

  return normalizeBillingLimits(plan?.entitlements);
}

function getBillingSeatLimit(
  billing: StripeBillingOptions | undefined,
  planId: string,
  snapshot: StripeBillingSnapshot | null | undefined,
): {
  limit: number | null;
  source: StripeBillingSeatLimitSource;
} {
  if (typeof snapshot?.seatAllowanceOverride === "number") {
    return {
      limit: snapshot.seatAllowanceOverride,
      source: "override",
    };
  }

  if (
    getBillingSeatsMode(billing) === "subscription_quantity" &&
    typeof snapshot?.seatQuantity === "number"
  ) {
    return {
      limit: snapshot.seatQuantity,
      source: "subscription_quantity",
    };
  }

  const configuredSeatLimit = getConfiguredBillingLimits(billing, planId).seats;
  if (typeof configuredSeatLimit === "number") {
    return {
      limit: configuredSeatLimit,
      source: "plan_limit",
    };
  }

  return {
    limit: null,
    source: "none",
  };
}

function getBillingLimits(
  billing: StripeBillingOptions | undefined,
  planId: string,
  snapshot?: StripeBillingSnapshot | null,
): StripeBillingLimits {
  const limits = {
    ...getConfiguredBillingLimits(billing, planId),
  };
  const seatLimit = getBillingSeatLimit(billing, planId, snapshot);

  if (seatLimit.limit !== null) {
    limits.seats = seatLimit.limit;
  }

  return limits;
}

function getBillingEntitlements(
  billing: StripeBillingOptions | undefined,
  planId: string,
  snapshot?: StripeBillingSnapshot | null,
): Record<string, unknown> {
  const plan = getBillingPlan(billing, planId);
  if (plan?.entitlements) {
    const nextEntitlements = {
      ...plan.entitlements,
    };

    const existingLimits =
      nextEntitlements.limits && typeof nextEntitlements.limits === "object"
        ? normalizeBillingLimits(nextEntitlements.limits)
        : {};
    const limits = getBillingLimits(billing, planId, snapshot);

    if (Object.keys(limits).length > 0) {
      nextEntitlements.limits = {
        ...existingLimits,
        ...limits,
      };
    }

    return nextEntitlements;
  }

  const features = getBillingFeatures(billing, planId);
  const limits = getBillingLimits(billing, planId, snapshot);

  if (Object.keys(features).length === 0 && Object.keys(limits).length === 0) {
    return {};
  }

  return {
    features,
    limits,
  };
}

function getBillingLimitForKey(
  billing: StripeBillingOptions | undefined,
  planId: string,
  snapshot: StripeBillingSnapshot | null | undefined,
  key: string,
): number | null {
  const value = getBillingLimits(billing, planId, snapshot)[key];
  return typeof value === "number" ? value : null;
}

function resolvePlanLimitReference(
  value: StripeBillingSoftLimit | undefined,
  defaultKey: string,
): StripeBillingPlanLimitReference | null {
  if (!value || value === "plan_limit" || typeof value === "number") {
    return null;
  }

  if (typeof value === "string") {
    const match = /^plans\.([^.]+)\.limits?\.([^.]+)$/.exec(value);
    if (!match) {
      return null;
    }

    return {
      planId: match[1]!,
      key: match[2]!,
    };
  }

  if (typeof value.planId === "string" && value.planId.trim()) {
    return {
      planId: value.planId,
      key: typeof value.key === "string" && value.key.trim() ? value.key : defaultKey,
    };
  }

  return null;
}

function isPastDueBillingStatus(status: string | null | undefined): boolean {
  return status === "past_due" || status === "unpaid";
}

function resolveMeterSoftLimit(
  billing: StripeBillingOptions | undefined,
  meter: StripeBillingMeter,
  planId: string,
  snapshot: StripeBillingSnapshot | null | undefined,
  key: string,
  includedLimit: number | null,
): number | null {
  const configuredSoftLimit = meter.guard?.softLimit;
  if (configuredSoftLimit === undefined || configuredSoftLimit === "plan_limit") {
    return typeof includedLimit === "number" && includedLimit >= 0 ? includedLimit : null;
  }

  const reference = resolvePlanLimitReference(configuredSoftLimit, key);
  if (reference) {
    const referencedLimit = getBillingLimitForKey(
      billing,
      reference.planId,
      reference.planId === planId ? snapshot : null,
      reference.key ?? key,
    );
    return typeof referencedLimit === "number" && referencedLimit >= 0 ? referencedLimit : null;
  }

  return typeof configuredSoftLimit === "number" &&
    Number.isInteger(configuredSoftLimit) &&
    configuredSoftLimit >= 0
    ? configuredSoftLimit
    : null;
}

function resolveMeterHardLimit(
  meter: StripeBillingMeter,
  planId: string,
  includedLimit: number | null,
): number | null {
  const hardLimitByPlan = meter.guard?.hardLimitByPlan?.[planId];
  if (
    typeof hardLimitByPlan === "number" &&
    Number.isInteger(hardLimitByPlan) &&
    hardLimitByPlan >= 0
  ) {
    return hardLimitByPlan;
  }

  const hardOverageByPlan = meter.guard?.hardOverageByPlan?.[planId];
  if (
    typeof hardOverageByPlan === "number" &&
    Number.isInteger(hardOverageByPlan) &&
    hardOverageByPlan >= 0 &&
    typeof includedLimit === "number" &&
    includedLimit >= 0
  ) {
    return includedLimit + hardOverageByPlan;
  }

  if (Number.isInteger(meter.guard?.hardLimit) && meter.guard!.hardLimit! >= 0) {
    return meter.guard!.hardLimit!;
  }

  if (
    Number.isInteger(meter.guard?.hardOverage) &&
    meter.guard!.hardOverage! >= 0 &&
    typeof includedLimit === "number" &&
    includedLimit >= 0
  ) {
    return includedLimit + meter.guard!.hardOverage!;
  }

  return null;
}

function evaluateStripeMeterUsage(input: {
  meter: StripeBillingMeter;
  billingStatus: StripeBillingStatus;
  attached: boolean;
  currentPeriodUsed: number;
  includedLimit: number | null;
  softLimit: number | null;
  hardLimit: number | null;
}): StripeMeterUsageEvaluation {
  const { meter, billingStatus, attached, currentPeriodUsed, includedLimit, softLimit, hardLimit } =
    input;
  const remainingIncluded =
    typeof includedLimit === "number" && includedLimit >= 0
      ? Math.max(0, includedLimit - currentPeriodUsed)
      : null;
  const remainingHard =
    typeof hardLimit === "number" && hardLimit >= 0
      ? Math.max(0, hardLimit - currentPeriodUsed)
      : null;

  if ((meter.guard?.blockOnPastDue ?? true) && isPastDueBillingStatus(billingStatus)) {
    return {
      currentPeriodUsed,
      includedLimit,
      softLimit,
      hardLimit,
      remainingIncluded,
      remainingHard,
      state: "blocked_past_due",
      warning:
        "This subscription is past due, so additional metered usage is blocked until billing is brought current.",
    };
  }

  if (!attached) {
    return {
      currentPeriodUsed,
      includedLimit,
      softLimit,
      hardLimit,
      remainingIncluded,
      remainingHard,
      state: "subscription_missing_meter_price",
      warning:
        "This subscription is missing the metered price item for this usage key, so Stripe cannot invoice the reported usage yet.",
    };
  }

  if (typeof hardLimit === "number" && hardLimit >= 0 && currentPeriodUsed >= hardLimit) {
    return {
      currentPeriodUsed,
      includedLimit,
      softLimit,
      hardLimit,
      remainingIncluded,
      remainingHard,
      state: "hard_limit_reached",
      warning:
        "The configured metered hard cap has been reached for the current billing period. Reported usage is blocked until the next cycle or a plan change.",
    };
  }

  if (typeof softLimit === "number" && softLimit >= 0 && currentPeriodUsed >= softLimit) {
    return {
      currentPeriodUsed,
      includedLimit,
      softLimit,
      hardLimit,
      remainingIncluded,
      remainingHard,
      state: "soft_limit_reached",
      warning:
        "The included monthly allowance has been reached. Additional metered usage is now in overage territory.",
    };
  }

  return {
    currentPeriodUsed,
    includedLimit,
    softLimit,
    hardLimit,
    remainingIncluded,
    remainingHard,
    state: "ok",
    warning: null,
  };
}

function resolveDesiredSubscriptionQuantity(
  snapshot: StripeBillingSnapshot,
  billing: StripeBillingOptions | undefined,
  product: ResolvedStripeProduct,
): number {
  if (product.seatBilling === "included_plus_add_on") {
    const includedSeats = getConfiguredSeatBaseLimit(billing, product) ?? product.quantity ?? 1;
    const currentQuantity =
      typeof snapshot.seatQuantity === "number" && snapshot.seatQuantity > 0
        ? snapshot.seatQuantity
        : includedSeats;
    return Math.max(includedSeats, currentQuantity, 1);
  }

  if (typeof snapshot.seatQuantity === "number" && snapshot.seatQuantity > 0) {
    return snapshot.seatQuantity;
  }

  return Math.max(product.quantity ?? 1, 1);
}

function getSubscriptionCurrentPeriodStart(subscription: Stripe.Subscription): string | null {
  const startTime = subscription.items.data[0]?.current_period_start;
  return typeof startTime === "number" ? new Date(startTime * 1000).toISOString() : null;
}

function getSubscriptionCurrentPeriodEnd(subscription: Stripe.Subscription): string | null {
  const endTime = subscription.items.data[0]?.current_period_end;
  return typeof endTime === "number" ? new Date(endTime * 1000).toISOString() : null;
}

function deriveFallbackCurrentPeriodStart(
  currentPeriodEnd: string | null,
  product: ResolvedStripeProduct | null,
): string | null {
  if (!currentPeriodEnd || !product?.interval) {
    return null;
  }

  const date = new Date(currentPeriodEnd);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const intervalCount =
    typeof product.intervalCount === "number" && product.intervalCount > 0
      ? product.intervalCount
      : 1;

  switch (product.interval) {
    case "day":
      date.setDate(date.getDate() - intervalCount);
      break;
    case "week":
      date.setDate(date.getDate() - intervalCount * 7);
      break;
    case "month":
      date.setMonth(date.getMonth() - intervalCount);
      break;
    case "year":
      date.setFullYear(date.getFullYear() - intervalCount);
      break;
  }

  return date.toISOString();
}

function alignIsoToMinuteTimestamp(value: string, mode: "floor" | "ceil"): number {
  const date = new Date(value);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) {
    throw new Error("Stripe meter usage requires a valid period timestamp.");
  }

  const minute = 60_000;
  const aligned =
    mode === "floor"
      ? Math.floor(timestamp / minute) * minute
      : Math.ceil(timestamp / minute) * minute;

  return Math.floor(aligned / 1000);
}

async function ensureConfiguredMeterItemsAttached(input: {
  owner: StripeBillingOwner;
  snapshot: StripeBillingSnapshot;
  product: ResolvedStripeProduct | null;
  billing: StripeBillingOptions | undefined;
  products: readonly ResolvedStripeProduct[];
  persistence: ReturnType<typeof resolveBillingPersistence>;
  stripeSdk: Stripe | null;
  instance: StripeIntegrationAdapter;
}): Promise<StripeBillingSnapshot> {
  const { owner, snapshot, product, billing, products, persistence, stripeSdk, instance } = input;

  let nextSnapshot = snapshot;
  let nextProduct = product;

  if (
    !stripeSdk ||
    !snapshot.stripeSubscriptionId ||
    typeof instance.updateSubscription !== "function"
  ) {
    return nextSnapshot;
  }

  const subscription = await stripeSdk.subscriptions.retrieve(snapshot.stripeSubscriptionId, {
    expand: ["items.data.price.product"],
  });

  if ("deleted" in subscription && subscription.deleted) {
    return nextSnapshot;
  }

  const inferredProduct = inferConfiguredProductForSnapshot(products, nextSnapshot, subscription);

  if (inferredProduct && nextSnapshot.productId !== inferredProduct.id) {
    nextSnapshot = {
      ...nextSnapshot,
      productId: inferredProduct.id,
    };
    await persistBillingSnapshot(nextSnapshot, billing, persistence, snapshot);
    nextProduct = inferredProduct;
  } else if (!nextProduct) {
    nextProduct = inferredProduct;
  }

  if (
    !nextProduct ||
    nextProduct.kind !== "subscription" ||
    !nextProduct.meterPriceIds ||
    Object.keys(nextProduct.meterPriceIds).length === 0
  ) {
    return nextSnapshot;
  }

  const missingMeterPriceIds = Object.values(nextProduct.meterPriceIds).filter(
    (priceId) => !subscription.items.data.some((item) => item.price.id === priceId),
  );

  if (missingMeterPriceIds.length === 0) {
    return nextSnapshot;
  }

  const desiredQuantity = resolveDesiredSubscriptionQuantity(nextSnapshot, billing, nextProduct);
  const lineItems = resolveCheckoutLineItems(
    nextProduct,
    desiredQuantity,
    billing,
    nextSnapshot.planId,
  );
  const subscriptionId = nextSnapshot.stripeSubscriptionId;
  if (!subscriptionId) {
    return nextSnapshot;
  }
  try {
    const updated = await instance.updateSubscription({
      subscriptionId,
      product: nextProduct,
      lineItems,
      prorationBehavior: "none",
    });
    nextSnapshot = createBillingSnapshotFromSubscriptionChange(
      owner,
      updated,
      billing,
      products,
      nextSnapshot,
    );
    await persistBillingSnapshot(nextSnapshot, billing, persistence, snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message.includes("already using that Price") ||
      message.includes("already has this price")
    ) {
      return nextSnapshot;
    }

    throw error;
  }
  return nextSnapshot;
}

async function prepareStripeMeterContext(input: {
  owner: StripeBillingOwner;
  key: string;
  snapshot: StripeBillingSnapshot;
  billing: StripeBillingOptions | undefined;
  products: readonly ResolvedStripeProduct[];
  persistence: ReturnType<typeof resolveBillingPersistence>;
  stripeSdk: Stripe | null;
  instance: StripeIntegrationAdapter;
}): Promise<StripePreparedMeterContext> {
  const { owner, key, billing, products, persistence, stripeSdk, instance } = input;
  const nextSnapshot = await ensureConfiguredMeterItemsAttached({
    owner,
    snapshot: input.snapshot,
    product: findConfiguredProduct(products, input.snapshot.productId),
    billing,
    products,
    persistence,
    stripeSdk,
    instance,
  });
  const product = findConfiguredProduct(products, nextSnapshot.productId);
  const attachedPriceId = product?.meterPriceIds?.[key] ?? null;

  if (!stripeSdk || !nextSnapshot.stripeSubscriptionId) {
    return {
      snapshot: nextSnapshot,
      product,
      attachedPriceId,
      subscriptionStatus: nextSnapshot.status,
      currentPeriodStart:
        deriveFallbackCurrentPeriodStart(
          nextSnapshot.currentPeriodEnd?.toISOString() ?? null,
          product,
        ) ?? null,
      currentPeriodEnd: nextSnapshot.currentPeriodEnd?.toISOString() ?? null,
      meterId: null,
      attached: false,
    };
  }

  const subscription = await stripeSdk.subscriptions.retrieve(nextSnapshot.stripeSubscriptionId, {
    expand: ["items.data.price.product"],
  });

  if ("deleted" in subscription && subscription.deleted) {
    return {
      snapshot: nextSnapshot,
      product,
      attachedPriceId,
      subscriptionStatus: nextSnapshot.status,
      currentPeriodStart: null,
      currentPeriodEnd: nextSnapshot.currentPeriodEnd?.toISOString() ?? null,
      meterId: null,
      attached: false,
    };
  }

  let meterId: string | null = null;
  if (attachedPriceId) {
    const price = await stripeSdk.prices.retrieve(attachedPriceId);
    if (!("deleted" in price && price.deleted)) {
      meterId = price.recurring?.meter ?? null;
    }
  }

  return {
    snapshot: nextSnapshot,
    product,
    attachedPriceId,
    subscriptionStatus: normalizeBillingStatus(subscription.status, nextSnapshot.status),
    currentPeriodStart:
      getSubscriptionCurrentPeriodStart(subscription) ??
      deriveFallbackCurrentPeriodStart(
        getSubscriptionCurrentPeriodEnd(subscription) ??
          nextSnapshot.currentPeriodEnd?.toISOString() ??
          null,
        product,
      ),
    currentPeriodEnd:
      getSubscriptionCurrentPeriodEnd(subscription) ??
      nextSnapshot.currentPeriodEnd?.toISOString() ??
      null,
    meterId,
    attached: attachedPriceId
      ? subscription.items.data.some((item) => item.price.id === attachedPriceId)
      : false,
  };
}

async function loadStripeMeterCurrentPeriodUsage(input: {
  stripeSdk: Stripe | null;
  meterId: string | null;
  customerId: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}): Promise<number> {
  const { stripeSdk, meterId, customerId, currentPeriodStart, currentPeriodEnd } = input;
  if (!stripeSdk || !meterId || !currentPeriodStart || !currentPeriodEnd) {
    return 0;
  }

  let startTime = alignIsoToMinuteTimestamp(currentPeriodStart, "floor");
  let endTime = alignIsoToMinuteTimestamp(currentPeriodEnd, "ceil");
  if (endTime <= startTime) {
    endTime = startTime + 60;
  }

  const summaries = await stripeSdk.billing.meters.listEventSummaries(meterId, {
    customer: customerId,
    start_time: startTime,
    end_time: endTime,
    limit: 1,
  });

  return summaries.data[0]?.aggregated_value ?? 0;
}

function findConfiguredProduct(
  products: readonly ResolvedStripeProduct[],
  productId: string | null | undefined,
): ResolvedStripeProduct | null {
  if (!productId) {
    return null;
  }

  return products.find((product) => product.id === productId) ?? null;
}

function getSubscriptionInterval(
  subscription: Stripe.Subscription,
): Stripe.Price.Recurring.Interval | null {
  for (const item of subscription.items.data) {
    const interval = item.price.recurring?.interval;
    if (interval) {
      return interval;
    }
  }

  return null;
}

function inferConfiguredProductForSnapshot(
  products: readonly ResolvedStripeProduct[],
  snapshot: StripeBillingSnapshot,
  subscription: Stripe.Subscription | null,
): ResolvedStripeProduct | null {
  const existing = findConfiguredProduct(products, snapshot.productId);
  if (existing) {
    return existing;
  }

  const candidates = products.filter(
    (product) => product.kind === "subscription" && product.planId === snapshot.planId,
  );

  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0] ?? null;
  }

  const interval = subscription ? getSubscriptionInterval(subscription) : null;
  if (!interval) {
    return null;
  }

  const intervalMatches = candidates.filter((product) => product.interval === interval);
  return intervalMatches.length === 1 ? (intervalMatches[0] ?? null) : null;
}

function getConfiguredSeatBaseLimit(
  billing: StripeBillingOptions | undefined,
  product: ResolvedStripeProduct | null,
): number | null {
  if (!product?.planId) {
    return null;
  }

  const limit = getConfiguredBillingLimits(billing, product.planId).seats;
  return typeof limit === "number" && Number.isInteger(limit) && limit >= 0 ? limit : null;
}

function getSeatQuantityFromLineItems(session: StripeSessionResult): number | null {
  const quantity = session.lineItems[0]?.quantity;
  return typeof quantity === "number" && Number.isInteger(quantity) && quantity > 0
    ? quantity
    : null;
}

function getSeatAddOnQuantityFromLineItems(
  session: StripeSessionResult,
  seatPriceId: string,
): number {
  for (const lineItem of session.lineItems) {
    if (lineItem.priceId !== seatPriceId) {
      continue;
    }

    const quantity = lineItem.quantity;
    if (typeof quantity === "number" && Number.isInteger(quantity) && quantity > 0) {
      return quantity;
    }
  }

  return 0;
}

function getSeatQuantityFromSubscriptionEvent(eventData: Record<string, unknown>): number | null {
  const items = eventData.items;
  if (!items || typeof items !== "object" || !("data" in items) || !Array.isArray(items.data)) {
    return null;
  }

  const firstItem = items.data[0];
  if (!firstItem || typeof firstItem !== "object" || !("quantity" in firstItem)) {
    return null;
  }

  const quantity = firstItem.quantity;
  return typeof quantity === "number" && Number.isInteger(quantity) && quantity > 0
    ? quantity
    : null;
}

function getSeatAddOnQuantityFromSubscriptionEvent(
  eventData: Record<string, unknown>,
  seatPriceId: string,
): number {
  const items = eventData.items;
  if (!items || typeof items !== "object" || !("data" in items) || !Array.isArray(items.data)) {
    return 0;
  }

  for (const item of items.data) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const price =
      "price" in item && item.price && typeof item.price === "object" ? item.price : null;
    if (!price || !("id" in price) || price.id !== seatPriceId) {
      continue;
    }

    const quantity = "quantity" in item ? item.quantity : null;
    if (typeof quantity === "number" && Number.isInteger(quantity) && quantity > 0) {
      return quantity;
    }
  }

  return 0;
}

function resolveSeatQuantityFromSession(
  session: StripeSessionResult,
  billing: StripeBillingOptions | undefined,
  products: readonly ResolvedStripeProduct[],
  previousSnapshot: StripeBillingSnapshot | null,
): number | null {
  const configuredProduct = findConfiguredProduct(products, resolveProductIdFromSession(session));

  if (configuredProduct?.seatBilling === "included_plus_add_on") {
    const includedSeats = getConfiguredSeatBaseLimit(billing, configuredProduct);
    if (includedSeats !== null) {
      return (
        includedSeats +
        (configuredProduct.seatPriceId
          ? getSeatAddOnQuantityFromLineItems(session, configuredProduct.seatPriceId)
          : 0)
      );
    }
  }

  return getSeatQuantityFromLineItems(session) ?? previousSnapshot?.seatQuantity ?? null;
}

function resolveSeatQuantityFromSubscriptionData(
  eventData: Record<string, unknown>,
  billing: StripeBillingOptions | undefined,
  products: readonly ResolvedStripeProduct[],
  existingSnapshot: StripeBillingSnapshot,
): number | null {
  const configuredProduct = findConfiguredProduct(products, existingSnapshot.productId);

  if (configuredProduct?.seatBilling === "included_plus_add_on") {
    const includedSeats = getConfiguredSeatBaseLimit(billing, configuredProduct);
    if (includedSeats !== null) {
      return (
        includedSeats +
        (configuredProduct.seatPriceId
          ? getSeatAddOnQuantityFromSubscriptionEvent(eventData, configuredProduct.seatPriceId)
          : 0)
      );
    }
  }

  return getSeatQuantityFromSubscriptionEvent(eventData) ?? existingSnapshot.seatQuantity;
}

async function resolveBillingUsage(
  billing: StripeBillingOptions | undefined,
  owner: StripeBillingOwner,
  key: string,
  tools: StripeBillingHookTools,
): Promise<number | null> {
  if (!billing?.usage) {
    return null;
  }

  const value = await billing.usage.resolve(owner, key, tools);
  return typeof value === "number" ? value : null;
}

function getBillingMeter(
  billing: StripeBillingOptions | undefined,
  key: string,
): StripeBillingMeter | null {
  const meter = billing?.meters?.[key];
  return meter ?? null;
}

function hasConfiguredStorageRuntimeClient(context: FarmIntegrationHandlerContext): boolean {
  const storage = (context.config as { storage?: unknown }).storage;
  return (
    !!storage &&
    typeof storage === "object" &&
    "client" in storage &&
    (storage as { client?: unknown }).client != null
  );
}

function resolveConfiguredBillingStorage(
  context: FarmIntegrationHandlerContext,
  schema: FarmIntegrationSchema,
): StripeBillingStorageAdapter | undefined {
  if (!hasConfiguredStorageRuntimeClient(context)) {
    return undefined;
  }

  let ormPromise: ReturnType<typeof createIntegrationOrm> | undefined;
  return ormStorageAdapter({
    orm: () =>
      (ormPromise ??= createIntegrationOrm({
        schema,
        config: context.config,
      })),
  });
}

function resolveBillingPersistence(
  billing: StripeBillingOptions | undefined,
  context: FarmIntegrationHandlerContext,
  stripe: Stripe | null,
  schema: FarmIntegrationSchema = stripeSchema,
) {
  const tools: StripeBillingHookTools = {
    ctx: context,
    stripe,
  };
  const storage = billing?.storage ?? resolveConfiguredBillingStorage(context, schema);

  return {
    tools,
    getBillingAccount: billing?.hooks?.getBillingAccount
      ? (owner: StripeBillingOwner) => billing.hooks!.getBillingAccount!(owner, tools)
      : storage?.getBillingAccount
        ? (owner: StripeBillingOwner) => storage.getBillingAccount(owner)
        : undefined,
    getBillingAccountByStripeCustomerId: billing?.hooks?.getBillingAccountByStripeCustomerId
      ? (customerId: string) =>
          billing.hooks!.getBillingAccountByStripeCustomerId!(customerId, tools)
      : storage?.getBillingAccountByStripeCustomerId
        ? (customerId: string) => storage.getBillingAccountByStripeCustomerId(customerId)
        : undefined,
    ensureCustomer: billing?.hooks?.ensureCustomer
      ? (owner: StripeBillingOwner) => billing.hooks!.ensureCustomer!(owner, tools)
      : storage?.ensureCustomer
        ? stripe
          ? (owner: StripeBillingOwner) =>
              storage.ensureCustomer({
                owner,
                stripe,
              })
          : undefined
        : undefined,
    saveBillingSnapshot: billing?.hooks?.saveBillingSnapshot
      ? (snapshot: StripeBillingSnapshot) => billing.hooks!.saveBillingSnapshot!(snapshot, tools)
      : storage?.saveBillingSnapshot
        ? (snapshot: StripeBillingSnapshot) => storage.saveBillingSnapshot(snapshot)
        : undefined,
    clearBillingSnapshot: billing?.hooks?.clearBillingSnapshot
      ? (owner: StripeBillingOwner) => billing.hooks!.clearBillingSnapshot!(owner, tools)
      : storage?.clearBillingSnapshot
        ? (owner: StripeBillingOwner) => storage.clearBillingSnapshot(owner)
        : undefined,
  };
}

function requireBillingMethod<T>(value: T | undefined, label: string): T {
  if (!value) {
    throw new Error(`Stripe billing requires ${label}.`);
  }

  return value;
}

function resolveProductIdFromSession(session: StripeSessionResult): string | null {
  return session.metadata.productId || session.lineItems[0]?.productId || null;
}

function resolvePlanIdFromSession(session: StripeSessionResult, fallbackPlanId = "free"): string {
  return session.metadata.planId || fallbackPlanId;
}

function resolvePlanIdForProduct(
  product: ResolvedStripeProduct,
  existingSnapshot: StripeBillingSnapshot | null,
): string {
  return product.planId ?? existingSnapshot?.planId ?? "free";
}

function hasActiveBillingSnapshot(snapshot: StripeBillingSnapshot | null): boolean {
  if (!snapshot) {
    return false;
  }

  return (
    snapshot.status === "trialing" ||
    snapshot.status === "active" ||
    snapshot.status === "past_due" ||
    snapshot.status === "unpaid" ||
    snapshot.status === "incomplete"
  );
}

async function resolveCheckoutTrial(
  billing: StripeBillingOptions | undefined,
  owner: StripeBillingOwner | null,
  product: ResolvedStripeProduct,
  existingSnapshot: StripeBillingSnapshot | null,
  tools: StripeBillingHookTools,
): Promise<StripeBillingTrial | null> {
  if (!billing || !owner || product.kind !== "subscription") {
    return null;
  }

  const planId = resolvePlanIdForProduct(product, existingSnapshot);
  const trial = getBillingTrial(billing, planId);
  if (!trial) {
    return null;
  }

  if (!Number.isInteger(trial.days) || trial.days <= 0) {
    throw new Error(`Stripe billing plan "${planId}" has an invalid trial.days value.`);
  }

  if (hasActiveBillingSnapshot(existingSnapshot)) {
    return null;
  }

  const hasUsedTrial = Boolean(existingSnapshot?.trialUsedAt);
  if ((trial.oncePerOwner ?? true) && hasUsedTrial) {
    return null;
  }

  if (trial.eligible) {
    const eligible = await trial.eligible(
      {
        owner,
        planId,
        productId: product.id,
        existingSnapshot,
        hasUsedTrial,
      },
      tools,
    );

    if (!eligible) {
      return null;
    }
  }

  return trial;
}

function validateBillingCatalog(
  billing: StripeBillingOptions | undefined,
  products: readonly ResolvedStripeProduct[],
) {
  if (!billing) {
    return;
  }

  for (const [planId, plan] of Object.entries(billing.plans ?? {})) {
    if (!plan.trial) {
      continue;
    }

    if (!Number.isInteger(plan.trial.days) || plan.trial.days <= 0) {
      throw new Error(`Stripe billing plan "${planId}" has an invalid trial.days value.`);
    }
  }

  for (const [key, meter] of Object.entries(billing.meters ?? {})) {
    if (!meter.eventName || !meter.eventName.trim()) {
      throw new Error(`Stripe billing meter "${key}" requires a non-empty eventName.`);
    }
  }

  for (const product of products) {
    if (product.kind === "subscription" && !product.planId) {
      throw new Error(
        `Stripe billing product "${product.id}" must set planId for subscription products.`,
      );
    }

    if (product.planId && !billing.plans?.[product.planId]) {
      throw new Error(
        `Stripe billing product "${product.id}" references unknown plan "${product.planId}".`,
      );
    }

    if (product.seatBilling === "included_plus_add_on" && product.kind !== "subscription") {
      throw new Error(
        `Stripe billing product "${product.id}" can only use seatBilling="included_plus_add_on" on subscription products.`,
      );
    }

    if (product.seatPriceId && product.kind !== "subscription") {
      throw new Error(
        `Stripe billing product "${product.id}" can only set seatPriceId on subscription products.`,
      );
    }

    if (product.meterPriceIds && product.kind !== "subscription") {
      throw new Error(
        `Stripe billing product "${product.id}" can only set meterPriceIds on subscription products.`,
      );
    }

    for (const [meterKey, priceId] of Object.entries(product.meterPriceIds ?? {})) {
      if (!billing.meters?.[meterKey]) {
        throw new Error(
          `Stripe billing product "${product.id}" references unknown meter "${meterKey}" in meterPriceIds.`,
        );
      }

      if (typeof priceId !== "string" || !priceId.trim()) {
        throw new Error(
          `Stripe billing product "${product.id}" requires a non-empty price id for meter "${meterKey}".`,
        );
      }
    }

    if (product.seatBilling === "included_plus_add_on") {
      const configuredSeatLimit =
        product.planId != null ? getConfiguredBillingLimits(billing, product.planId).seats : null;

      if (
        typeof configuredSeatLimit !== "number" ||
        !Number.isInteger(configuredSeatLimit) ||
        configuredSeatLimit <= 0
      ) {
        throw new Error(
          `Stripe billing product "${product.id}" requires a positive integer plans["${product.planId}"].limits.seats when seatBilling="included_plus_add_on".`,
        );
      }
    }
  }
}

function createBillingSnapshot(
  owner: StripeBillingOwner,
  session: StripeSessionResult,
  billing: StripeBillingOptions | undefined,
  products: readonly ResolvedStripeProduct[],
  fallbackPlanId = "free",
  previousSnapshot: StripeBillingSnapshot | null = null,
): StripeBillingSnapshot {
  const status =
    session.mode === "subscription"
      ? normalizeBillingStatus(session.subscriptionStatus, "active")
      : normalizeBillingStatus(session.paymentStatus, "active");
  const trialEndsAt = session.trialEndsAt
    ? new Date(session.trialEndsAt)
    : (previousSnapshot?.trialEndsAt ?? null);
  const trialUsedAt =
    status === "trialing"
      ? (previousSnapshot?.trialUsedAt ?? new Date())
      : (previousSnapshot?.trialUsedAt ?? null);
  const seatQuantity =
    getBillingSeatsMode(billing) === "subscription_quantity" && session.mode === "subscription"
      ? resolveSeatQuantityFromSession(session, billing, products, previousSnapshot)
      : (previousSnapshot?.seatQuantity ?? null);

  return {
    owner,
    planId: resolvePlanIdFromSession(session, fallbackPlanId),
    productId: resolveProductIdFromSession(session),
    status,
    stripeCustomerId: session.customerId ?? null,
    stripeSubscriptionId: session.subscriptionId ?? null,
    currentPeriodEnd: session.currentPeriodEnd ? new Date(session.currentPeriodEnd) : null,
    cancelAtPeriodEnd: session.cancelAtPeriodEnd ?? false,
    trialEndsAt,
    trialUsedAt,
    seatQuantity,
    seatAllowanceOverride: previousSnapshot?.seatAllowanceOverride ?? null,
    metadata: session.metadata,
  };
}

function createBillingSnapshotFromSubscriptionChange(
  owner: StripeBillingOwner,
  result: {
    customerId: string | null;
    subscriptionId: string;
    subscriptionStatus: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    lineItems: StripeSessionLineItemResult[];
  },
  billing: StripeBillingOptions | undefined,
  products: readonly ResolvedStripeProduct[],
  previousSnapshot: StripeBillingSnapshot,
): StripeBillingSnapshot {
  const nextSession = normalizeStripeSessionResult({
    id: result.subscriptionId,
    mode: "subscription",
    customerId: result.customerId,
    subscriptionId: result.subscriptionId,
    subscriptionStatus: result.subscriptionStatus,
    currentPeriodEnd: result.currentPeriodEnd,
    trialEndsAt: result.trialEndsAt,
    cancelAtPeriodEnd: result.cancelAtPeriodEnd,
    metadata: {
      ...previousSnapshot.metadata,
      planId: previousSnapshot.planId,
      ...(previousSnapshot.productId ? { productId: previousSnapshot.productId } : {}),
    },
    lineItems: result.lineItems,
  });
  const nextStatus = normalizeBillingStatus(result.subscriptionStatus, previousSnapshot.status);

  return {
    owner,
    planId: previousSnapshot.planId,
    productId: previousSnapshot.productId,
    status: nextStatus,
    stripeCustomerId: result.customerId ?? previousSnapshot.stripeCustomerId,
    stripeSubscriptionId: result.subscriptionId,
    currentPeriodEnd: result.currentPeriodEnd
      ? new Date(result.currentPeriodEnd)
      : previousSnapshot.currentPeriodEnd,
    cancelAtPeriodEnd: result.cancelAtPeriodEnd,
    trialEndsAt: result.trialEndsAt ? new Date(result.trialEndsAt) : null,
    trialUsedAt:
      nextStatus === "trialing"
        ? (previousSnapshot.trialUsedAt ?? new Date())
        : previousSnapshot.trialUsedAt,
    seatQuantity:
      getBillingSeatsMode(billing) === "subscription_quantity"
        ? resolveSeatQuantityFromSession(nextSession, billing, products, previousSnapshot)
        : previousSnapshot.seatQuantity,
    seatAllowanceOverride: previousSnapshot.seatAllowanceOverride,
    metadata: {
      ...previousSnapshot.metadata,
      ...(previousSnapshot.productId ? { productId: previousSnapshot.productId } : {}),
      planId: previousSnapshot.planId,
    },
  };
}

async function resolveBillingSnapshotForSession(
  session: StripeSessionResult,
  products: readonly ResolvedStripeProduct[],
  billing: StripeBillingOptions | undefined,
  persistence: ReturnType<typeof resolveBillingPersistence>,
  context: FarmIntegrationHandlerContext,
): Promise<StripeBillingSnapshot | null> {
  if (!billing) {
    return null;
  }

  let owner = await billing.resolveOwner(context);
  let existingSnapshot: StripeBillingSnapshot | null = null;

  if (session.customerId && persistence.getBillingAccountByStripeCustomerId) {
    const getByCustomerId = requireBillingMethod(
      persistence.getBillingAccountByStripeCustomerId,
      "getBillingAccountByStripeCustomerId",
    );
    existingSnapshot = await getByCustomerId(session.customerId);
    if (!owner) {
      owner = existingSnapshot?.owner ?? null;
    }
  }

  if (!owner) {
    return null;
  }

  return createBillingSnapshot(
    owner,
    session,
    billing,
    products,
    existingSnapshot?.planId ?? "free",
    existingSnapshot,
  );
}

async function persistBillingSnapshot(
  snapshot: StripeBillingSnapshot,
  billing: StripeBillingOptions | undefined,
  persistence: ReturnType<typeof resolveBillingPersistence>,
  previousSnapshot: StripeBillingSnapshot | null = null,
) {
  if (!billing) {
    return;
  }

  const saveBillingSnapshot = requireBillingMethod(
    persistence.saveBillingSnapshot,
    "saveBillingSnapshot",
  );
  await saveBillingSnapshot(snapshot);
  await billing.hooks?.onBillingSync?.(snapshot, persistence.tools);

  const trialDays = getBillingTrial(billing, snapshot.planId)?.days ?? null;
  if (snapshot.status === "trialing" && previousSnapshot?.status !== "trialing") {
    await billing.hooks?.onTrialStarted?.(
      {
        ...snapshot,
        trialDays: trialDays ?? 0,
      },
      persistence.tools,
    );
  } else if (previousSnapshot?.status === "trialing" && snapshot.status === "active") {
    await billing.hooks?.onTrialEnded?.(snapshot, persistence.tools);
  } else if (previousSnapshot?.status === "trialing" && snapshot.status !== "trialing") {
    await billing.hooks?.onTrialExpired?.(snapshot, persistence.tools);
  }

  if (snapshot.status === "active" || snapshot.status === "trialing") {
    await billing.hooks?.onPaymentSucceeded?.(snapshot, persistence.tools);
  } else if (snapshot.status === "past_due" || snapshot.status === "unpaid") {
    await billing.hooks?.onPaymentFailed?.(snapshot, persistence.tools);
  }
}

export function stripe<const TInput extends StripeIntegrationInput & StripeDefaultPathInput = {}>(
  input?: TInput,
): StripeIntegrationResult<StripeDefaultClientAPI>;
export function stripe<const TInput extends StripeIntegrationInput = {}>(
  input?: TInput,
): StripeIntegrationResult<StripeClientAPI<StripeResolvedApiInput<TInput>>>;
export function stripe<TInput extends StripeIntegrationInput = {}>(
  input: TInput = {} as TInput,
): StripeIntegrationResult<FarmIntegrationAPI> {
  const env = resolveEnv(input);
  const rawInstance = input.instance || (env.secretKey ? new Stripe(env.secretKey) : undefined);
  const instance = resolveStripeInstance(input, env);
  const stripeSdk = rawInstance && isStripeSdkInstance(rawInstance) ? rawInstance : null;
  const integrationSchema = input.schema ?? stripeSchema;

  const configuredProducts = input.billing?.products
    ? normalizeBillingProducts(input.billing.products)
    : normalizeProducts(input.products);
  validateBillingCatalog(input.billing, configuredProducts);
  const publicProducts = configuredProducts.filter((product) => product.public !== false);
  const productsPath = (input.productsPath ??
    input.checkoutPath?.replace(/checkout$/, "products") ??
    "/billing/products") as ResolvedStripeIntegrationPath<
    TInput["productsPath"],
    "/billing/products"
  >;
  const statusPath = (input.statusPath ?? "/billing/status") as ResolvedStripeIntegrationPath<
    TInput["statusPath"],
    "/billing/status"
  >;
  const currentChargesPath = (input.currentChargesPath ??
    "/billing/current-charges") as ResolvedStripeIntegrationPath<
    TInput["currentChargesPath"],
    "/billing/current-charges"
  >;
  const featuresPath = (input.featuresPath ?? "/billing/features") as ResolvedStripeIntegrationPath<
    TInput["featuresPath"],
    "/billing/features"
  >;
  const limitsPath = (input.limitsPath ?? "/billing/limits") as ResolvedStripeIntegrationPath<
    TInput["limitsPath"],
    "/billing/limits"
  >;
  const usagePath = (input.usagePath ?? "/billing/usage") as ResolvedStripeIntegrationPath<
    TInput["usagePath"],
    "/billing/usage"
  >;
  const meterUsagePath = (input.meterUsagePath ??
    "/billing/meter-usage") as ResolvedStripeIntegrationPath<
    TInput["meterUsagePath"],
    "/billing/meter-usage"
  >;
  const upcomingInvoicePath = (input.upcomingInvoicePath ??
    "/billing/upcoming-invoice") as ResolvedStripeIntegrationPath<
    TInput["upcomingInvoicePath"],
    "/billing/upcoming-invoice"
  >;
  const reportUsagePath = (input.reportUsagePath ??
    "/billing/report-usage") as ResolvedStripeIntegrationPath<
    TInput["reportUsagePath"],
    "/billing/report-usage"
  >;
  const checkPath = (input.checkPath ?? "/billing/check") as ResolvedStripeIntegrationPath<
    TInput["checkPath"],
    "/billing/check"
  >;
  const checkoutPath = (input.checkoutPath ?? "/billing/checkout") as ResolvedStripeIntegrationPath<
    TInput["checkoutPath"],
    "/billing/checkout"
  >;
  const upgradePath = (input.upgradePath ?? "/billing/upgrade") as ResolvedStripeIntegrationPath<
    TInput["upgradePath"],
    "/billing/upgrade"
  >;
  const portalPath = (input.portalPath ?? "/billing/portal") as ResolvedStripeIntegrationPath<
    TInput["portalPath"],
    "/billing/portal"
  >;
  const sessionPath = (input.sessionPath ?? "/billing/session") as ResolvedStripeIntegrationPath<
    TInput["sessionPath"],
    "/billing/session"
  >;
  const webhookPath = input.webhookPath ?? "/billing/webhook";
  const webhookDefinitions = resolveStripeWebhooks(input, env, webhookPath);
  const successPath = resolvePath(input.successPath, "Stripe integration successPath", "/success");
  const cancelPath = resolvePath(input.cancelPath, "Stripe integration cancelPath", "/cancel");
  const webhookRoutes = webhookDefinitions.map((definition) =>
    integrationRoute.post(definition.path, {
      responseFormat: "json",
      rawBody: true,
      async handler(request, context) {
        const payload = await request.text();
        const webhookContext = {
          request,
          route: context,
          rawBody: payload,
          headers: request.headers,
          webhook: {
            name: definition.name,
            path: definition.path,
          },
        };

        try {
          const verifiedEvent = await instance.constructWebhookEvent({
            payload,
            signature: request.headers.get("stripe-signature"),
            secret: definition.secret,
          });
          const event: StripeWebhookEvent = {
            provider: "stripe",
            id: verifiedEvent.id,
            type: verifiedEvent.type,
            data: verifiedEvent.data,
            raw: verifiedEvent.raw ?? verifiedEvent,
          };

          if (input.billing) {
            const persistence = resolveBillingPersistence(
              input.billing,
              context,
              stripeSdk,
              integrationSchema,
            );

            if (
              event.type === "checkout.session.completed" &&
              event.data &&
              typeof event.data === "object" &&
              "id" in event.data &&
              typeof event.data.id === "string"
            ) {
              const session = await instance.retrieveCheckoutSession(event.data.id);
              const snapshot = await resolveBillingSnapshotForSession(
                session,
                configuredProducts,
                input.billing,
                persistence,
                context,
              );

              if (snapshot) {
                const previousSnapshot =
                  session.customerId && persistence.getBillingAccountByStripeCustomerId
                    ? await persistence.getBillingAccountByStripeCustomerId(session.customerId)
                    : null;
                await persistBillingSnapshot(
                  snapshot,
                  input.billing,
                  persistence,
                  previousSnapshot,
                );
                await input.billing.hooks?.onCheckoutCompleted?.(
                  {
                    ...snapshot,
                    sessionId: session.id,
                  },
                  persistence.tools,
                );
              }
            } else if (
              event.data &&
              typeof event.data === "object" &&
              "customer" in event.data &&
              typeof event.data.customer === "string" &&
              persistence.getBillingAccountByStripeCustomerId
            ) {
              const existing = await persistence.getBillingAccountByStripeCustomerId(
                event.data.customer,
              );

              if (existing) {
                let nextSnapshot: StripeBillingSnapshot | null = null;

                if (event.type === "invoice.payment_failed") {
                  nextSnapshot = {
                    ...existing,
                    status: "past_due",
                  };
                } else if (event.type === "invoice.paid") {
                  nextSnapshot = {
                    ...existing,
                    status: "active",
                  };
                } else if (event.type === "customer.subscription.trial_will_end") {
                  const trialWillEndSnapshot = {
                    ...existing,
                    trialEndsAt:
                      "trial_end" in event.data && typeof event.data.trial_end === "number"
                        ? new Date(event.data.trial_end * 1000)
                        : existing.trialEndsAt,
                  };

                  await input.billing.hooks?.onTrialWillEnd?.(
                    trialWillEndSnapshot,
                    persistence.tools,
                  );
                } else if (
                  event.type === "customer.subscription.updated" &&
                  "status" in event.data &&
                  typeof event.data.status === "string"
                ) {
                  const nextStatus = normalizeBillingStatus(event.data.status, existing.status);
                  nextSnapshot = {
                    ...existing,
                    status: nextStatus,
                    stripeSubscriptionId:
                      "id" in event.data && typeof event.data.id === "string"
                        ? event.data.id
                        : existing.stripeSubscriptionId,
                    currentPeriodEnd:
                      "current_period_end" in event.data &&
                      typeof event.data.current_period_end === "number"
                        ? new Date(event.data.current_period_end * 1000)
                        : existing.currentPeriodEnd,
                    trialEndsAt:
                      "trial_end" in event.data && typeof event.data.trial_end === "number"
                        ? new Date(event.data.trial_end * 1000)
                        : existing.trialEndsAt,
                    trialUsedAt:
                      nextStatus === "trialing"
                        ? (existing.trialUsedAt ?? new Date())
                        : existing.trialUsedAt,
                    seatQuantity:
                      getBillingSeatsMode(input.billing) === "subscription_quantity"
                        ? resolveSeatQuantityFromSubscriptionData(
                            event.data as Record<string, unknown>,
                            input.billing,
                            configuredProducts,
                            existing,
                          )
                        : existing.seatQuantity,
                    seatAllowanceOverride: existing.seatAllowanceOverride,
                    cancelAtPeriodEnd:
                      "cancel_at_period_end" in event.data &&
                      typeof event.data.cancel_at_period_end === "boolean"
                        ? event.data.cancel_at_period_end
                        : existing.cancelAtPeriodEnd,
                  };
                }

                if (nextSnapshot) {
                  await persistBillingSnapshot(nextSnapshot, input.billing, persistence, existing);
                }
              }
            }
          }

          await definition.onEvent?.(event, webhookContext);

          return Response.json({
            received: true,
            provider: "stripe",
            webhook: definition.name,
            eventId: event.id,
            type: event.type,
          } satisfies StripeWebhookResult);
        } catch (error) {
          const override = await definition.onError?.(error, webhookContext);
          if (override) {
            return override;
          }

          return Response.json(
            {
              error: error instanceof Error ? error.message : "Stripe webhook verification failed.",
            },
            {
              status: 400,
            },
          );
        }
      },
    }),
  );

  return defineIntegration({
    category: "payment",
    type: "stripe",
    instance: {
      products: configuredProducts,
      successPath,
      cancelPath,
      liveMode: !!env.secretKey,
    },
    api: createStripeApi({
      productsPath,
      statusPath,
      currentChargesPath,
      featuresPath,
      limitsPath,
      usagePath,
      meterUsagePath,
      upcomingInvoicePath,
      reportUsagePath,
      checkPath,
      checkoutPath,
      upgradePath,
      portalPath,
      sessionPath,
    }) as unknown as FarmIntegrationAPI,
    schema: integrationSchema,
    log: input.log,
    routes: [
      integrationRoute.get<typeof productsPath, StripeCatalogProduct[]>(productsPath, {
        responseFormat: "json",
        async handler() {
          try {
            return Response.json(
              await resolveCatalogProducts(stripeSdk, publicProducts, input.billing),
            );
          } catch (error) {
            return Response.json(
              {
                error: error instanceof Error ? error.message : "Stripe product listing failed.",
              },
              {
                status: 400,
              },
            );
          }
        },
      }),
      integrationRoute.get<typeof statusPath, StripeBillingStatusResult>(statusPath, {
        responseFormat: "json",
        async handler(_request, context) {
          if (!input.billing) {
            return Response.json(
              {
                error: "Stripe billing is not configured for this integration.",
              },
              {
                status: 400,
              },
            );
          }

          const owner = await input.billing.resolveOwner(context);
          if (!owner) {
            return Response.json(
              {
                error: "You need to sign in before loading billing status.",
              },
              {
                status: 401,
              },
            );
          }

          const persistence = resolveBillingPersistence(
            input.billing,
            context,
            stripeSdk,
            integrationSchema,
          );
          const getBillingAccount = requireBillingMethod(
            persistence.getBillingAccount,
            "getBillingAccount",
          );
          let snapshot = await getBillingAccount(owner);

          if (snapshot) {
            try {
              snapshot = await ensureConfiguredMeterItemsAttached({
                owner,
                snapshot,
                product: findConfiguredProduct(configuredProducts, snapshot.productId),
                billing: input.billing,
                products: configuredProducts,
                persistence,
                stripeSdk,
                instance,
              });
            } catch {
              // Keep status reads resilient even if Stripe add-on self-healing fails.
            }
          }

          return Response.json(
            serializeBillingSnapshot(
              snapshot ?? {
                owner,
                planId: "free",
                productId: null,
                status: "free",
                stripeCustomerId: null,
                stripeSubscriptionId: null,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                trialEndsAt: null,
                trialUsedAt: null,
                seatQuantity: null,
                seatAllowanceOverride: null,
              },
              input.billing,
              getBillingFeatures(input.billing, snapshot?.planId ?? "free"),
              getBillingLimits(input.billing, snapshot?.planId ?? "free", snapshot),
              getBillingEntitlements(input.billing, snapshot?.planId ?? "free", snapshot),
            ),
          );
        },
      }),
      integrationRoute.get<typeof featuresPath, StripeBillingFeaturesResult>(featuresPath, {
        responseFormat: "json",
        async handler(_request, context) {
          if (!input.billing) {
            return Response.json(
              {
                error: "Stripe billing is not configured for this integration.",
              },
              {
                status: 400,
              },
            );
          }

          const owner = await input.billing.resolveOwner(context);
          if (!owner) {
            return Response.json(
              {
                error: "You need to sign in before loading billing features.",
              },
              {
                status: 401,
              },
            );
          }

          const persistence = resolveBillingPersistence(
            input.billing,
            context,
            stripeSdk,
            integrationSchema,
          );
          const getBillingAccount = requireBillingMethod(
            persistence.getBillingAccount,
            "getBillingAccount",
          );
          const snapshot = await getBillingAccount(owner);
          const planId = snapshot?.planId ?? "free";

          return Response.json({
            planId,
            features: getBillingFeatures(input.billing, planId),
          } satisfies StripeBillingFeaturesResult);
        },
      }),
      integrationRoute.get<typeof limitsPath, StripeBillingLimitsResult>(limitsPath, {
        responseFormat: "json",
        async handler(_request, context) {
          if (!input.billing) {
            return Response.json(
              {
                error: "Stripe billing is not configured for this integration.",
              },
              {
                status: 400,
              },
            );
          }

          const owner = await input.billing.resolveOwner(context);
          if (!owner) {
            return Response.json(
              {
                error: "You need to sign in before loading billing limits.",
              },
              {
                status: 401,
              },
            );
          }

          const persistence = resolveBillingPersistence(
            input.billing,
            context,
            stripeSdk,
            integrationSchema,
          );
          const getBillingAccount = requireBillingMethod(
            persistence.getBillingAccount,
            "getBillingAccount",
          );
          const snapshot = await getBillingAccount(owner);
          const planId = snapshot?.planId ?? "free";

          return Response.json({
            planId,
            limits: getBillingLimits(input.billing, planId, snapshot),
          } satisfies StripeBillingLimitsResult);
        },
      }),
      integrationRoute.post<typeof usagePath, StripeBillingUsageInput, StripeBillingUsageResult>(
        usagePath,
        {
          responseFormat: "json",
          async handler(request, context) {
            if (!input.billing) {
              return Response.json(
                {
                  error: "Stripe billing is not configured for this integration.",
                },
                {
                  status: 400,
                },
              );
            }

            const owner = await input.billing.resolveOwner(context);
            if (!owner) {
              return Response.json(
                {
                  error: "You need to sign in before loading billing usage.",
                },
                {
                  status: 401,
                },
              );
            }

            const body = await readJsonObject(request);
            const key = typeof body.key === "string" ? body.key.trim() : "";
            if (!key) {
              return Response.json(
                {
                  error: "Stripe billing usage requires a key.",
                },
                {
                  status: 400,
                },
              );
            }

            const persistence = resolveBillingPersistence(
              input.billing,
              context,
              stripeSdk,
              integrationSchema,
            );
            const getBillingAccount = requireBillingMethod(
              persistence.getBillingAccount,
              "getBillingAccount",
            );
            const snapshot = await getBillingAccount(owner);
            const planId = snapshot?.planId ?? "free";
            const limit = getBillingLimitForKey(input.billing, planId, snapshot, key);

            if (limit === null) {
              return Response.json(
                {
                  error: `Stripe billing limit "${key}" is not defined on plan "${planId}".`,
                },
                {
                  status: 404,
                },
              );
            }

            const used = await resolveBillingUsage(input.billing, owner, key, persistence.tools);

            return Response.json({
              planId,
              key,
              used,
              limit,
              remaining: typeof used === "number" && limit >= 0 ? Math.max(0, limit - used) : null,
            } satisfies StripeBillingUsageResult);
          },
        },
      ),
      integrationRoute.post<
        typeof meterUsagePath,
        StripeBillingMeterUsageInput,
        StripeBillingMeterUsageResult
      >(meterUsagePath, {
        responseFormat: "json",
        async handler(request, context) {
          if (!input.billing) {
            return Response.json(
              {
                error: "Stripe billing is not configured for this integration.",
              },
              {
                status: 400,
              },
            );
          }

          const owner = await input.billing.resolveOwner(context);
          if (!owner) {
            return Response.json(
              {
                error: "You need to sign in before loading Stripe meter usage.",
              },
              {
                status: 401,
              },
            );
          }

          const body = await readJsonObject(request);
          const key = typeof body.key === "string" ? body.key.trim() : "";
          if (!key) {
            return Response.json(
              {
                error: "Stripe meter usage requires a key.",
              },
              {
                status: 400,
              },
            );
          }

          const meter = getBillingMeter(input.billing, key);
          if (!meter) {
            return Response.json(
              {
                error: `Stripe billing meter "${key}" is not configured.`,
              },
              {
                status: 404,
              },
            );
          }

          const persistence = resolveBillingPersistence(
            input.billing,
            context,
            stripeSdk,
            integrationSchema,
          );
          const getBillingAccount = requireBillingMethod(
            persistence.getBillingAccount,
            "getBillingAccount",
          );
          const snapshot = await getBillingAccount(owner);
          if (!snapshot?.stripeCustomerId) {
            return Response.json(
              {
                error:
                  "The active billing owner does not have a Stripe customer yet. Subscribe first before loading meter usage.",
              },
              {
                status: 400,
              },
            );
          }

          if (!stripeSdk) {
            return Response.json(
              {
                error:
                  "Stripe meter usage summaries require a real Stripe SDK instance instead of a mock adapter.",
              },
              {
                status: 501,
              },
            );
          }

          const prepared = await prepareStripeMeterContext({
            owner,
            key,
            snapshot,
            billing: input.billing,
            products: configuredProducts,
            persistence,
            stripeSdk,
            instance,
          });
          const stripeCurrentPeriodUsed = await loadStripeMeterCurrentPeriodUsage({
            stripeSdk,
            meterId: prepared.meterId,
            customerId: prepared.snapshot.stripeCustomerId ?? snapshot.stripeCustomerId,
            currentPeriodStart: prepared.currentPeriodStart,
            currentPeriodEnd: prepared.currentPeriodEnd,
          });
          const currentPeriodUsed = resolveEffectiveStripeMeterCurrentPeriodUsed({
            customerId: prepared.snapshot.stripeCustomerId ?? snapshot.stripeCustomerId!,
            key,
            currentPeriodStart: prepared.currentPeriodStart,
            currentPeriodEnd: prepared.currentPeriodEnd,
            currentPeriodUsed: stripeCurrentPeriodUsed,
          });
          const includedLimit = getBillingLimitForKey(
            input.billing,
            prepared.snapshot.planId,
            prepared.snapshot,
            key,
          );
          const softLimit = resolveMeterSoftLimit(
            input.billing,
            meter,
            prepared.snapshot.planId,
            prepared.snapshot,
            key,
            includedLimit,
          );
          const hardLimit = resolveMeterHardLimit(meter, prepared.snapshot.planId, includedLimit);
          const evaluation = evaluateStripeMeterUsage({
            meter,
            billingStatus: prepared.subscriptionStatus,
            attached: prepared.attached,
            currentPeriodUsed,
            includedLimit,
            softLimit,
            hardLimit,
          });

          return Response.json({
            planId: prepared.snapshot.planId,
            productId: prepared.snapshot.productId,
            key,
            eventName: meter.eventName,
            customerId: prepared.snapshot.stripeCustomerId ?? snapshot.stripeCustomerId,
            subscriptionId: prepared.snapshot.stripeSubscriptionId,
            subscriptionStatus: prepared.subscriptionStatus,
            attached: prepared.attached,
            attachedPriceId: prepared.attachedPriceId,
            currentPeriodStart: prepared.currentPeriodStart,
            currentPeriodEnd: prepared.currentPeriodEnd,
            currentPeriodUsed: evaluation.currentPeriodUsed,
            includedLimit: evaluation.includedLimit,
            softLimit: evaluation.softLimit,
            hardLimit: evaluation.hardLimit,
            remainingIncluded: evaluation.remainingIncluded,
            remainingHard: evaluation.remainingHard,
            state: evaluation.state,
            warning: evaluation.warning,
          } satisfies StripeBillingMeterUsageResult);
        },
      }),
      integrationRoute.get(currentChargesPath, {
        responseFormat: "json",
        async handler(_request, context) {
          if (!input.billing) {
            return Response.json(
              {
                error: "Stripe billing is not configured for this integration.",
              },
              {
                status: 400,
              },
            );
          }

          const owner = await input.billing.resolveOwner(context);
          if (!owner) {
            return Response.json(
              {
                error: "You need to sign in before loading the current Stripe charges.",
              },
              {
                status: 401,
              },
            );
          }

          const persistence = resolveBillingPersistence(
            input.billing,
            context,
            stripeSdk,
            integrationSchema,
          );
          const getBillingAccount = requireBillingMethod(
            persistence.getBillingAccount,
            "getBillingAccount",
          );
          const snapshot = await getBillingAccount(owner);

          if (!snapshot?.stripeCustomerId || !snapshot.stripeSubscriptionId) {
            return Response.json(
              {
                error:
                  "The active billing owner does not have a paid Stripe subscription yet. Subscribe first before loading current charges.",
              },
              {
                status: 400,
              },
            );
          }

          const nextSnapshot = await ensureConfiguredMeterItemsAttached({
            owner,
            snapshot,
            product: findConfiguredProduct(configuredProducts, snapshot.productId),
            billing: input.billing,
            products: configuredProducts,
            persistence,
            stripeSdk,
            instance,
          });
          const product = findConfiguredProduct(configuredProducts, nextSnapshot.productId);
          const previewCustomerId = nextSnapshot.stripeCustomerId ?? snapshot.stripeCustomerId;
          const previewSubscriptionId =
            nextSnapshot.stripeSubscriptionId ?? snapshot.stripeSubscriptionId;

          if (!previewCustomerId || !previewSubscriptionId) {
            return Response.json(
              {
                error:
                  "The active billing owner does not have a Stripe subscription available for current charge preview.",
              },
              {
                status: 400,
              },
            );
          }

          let preview: StripeUpcomingInvoicePreview;
          if (typeof instance.previewUpcomingInvoice === "function") {
            preview = await instance.previewUpcomingInvoice({
              customerId: previewCustomerId,
              subscriptionId: previewSubscriptionId,
              product,
            });
          } else if (stripeSdk) {
            preview = await createStripeUpcomingInvoicePreviewFromSdk({
              stripe: stripeSdk,
              customerId: previewCustomerId,
              subscriptionId: previewSubscriptionId,
              product,
            });
          } else {
            return Response.json(
              {
                error:
                  "Current Stripe charges require either a real Stripe SDK instance or an adapter that supports previewUpcomingInvoice().",
              },
              {
                status: 501,
              },
            );
          }

          return Response.json(
            toStripeCurrentChargesResult({
              owner,
              snapshot: {
                ...nextSnapshot,
                stripeCustomerId: previewCustomerId,
                stripeSubscriptionId: previewSubscriptionId,
              },
              subscriptionStatus: nextSnapshot.status,
              currentPeriodStart: null,
              currentPeriodEnd: nextSnapshot.currentPeriodEnd?.toISOString() ?? null,
              preview,
              billing: input.billing,
            }) satisfies StripeBillingCurrentChargesResult,
          );
        },
      }),
      integrationRoute.get<typeof upcomingInvoicePath, StripeBillingUpcomingInvoiceResult>(
        upcomingInvoicePath,
        {
          responseFormat: "json",
          async handler(_request, context) {
            if (!input.billing) {
              return Response.json(
                {
                  error: "Stripe billing is not configured for this integration.",
                },
                {
                  status: 400,
                },
              );
            }

            const owner = await input.billing.resolveOwner(context);
            if (!owner) {
              return Response.json(
                {
                  error: "You need to sign in before loading the upcoming Stripe invoice.",
                },
                {
                  status: 401,
                },
              );
            }

            const persistence = resolveBillingPersistence(
              input.billing,
              context,
              stripeSdk,
              integrationSchema,
            );
            const getBillingAccount = requireBillingMethod(
              persistence.getBillingAccount,
              "getBillingAccount",
            );
            const snapshot = await getBillingAccount(owner);

            if (!snapshot?.stripeCustomerId || !snapshot.stripeSubscriptionId) {
              return Response.json(
                {
                  error:
                    "The active billing owner does not have a paid Stripe subscription yet. Subscribe first before loading the upcoming invoice preview.",
                },
                {
                  status: 400,
                },
              );
            }

            const nextSnapshot = await ensureConfiguredMeterItemsAttached({
              owner,
              snapshot,
              product: findConfiguredProduct(configuredProducts, snapshot.productId),
              billing: input.billing,
              products: configuredProducts,
              persistence,
              stripeSdk,
              instance,
            });
            const product = findConfiguredProduct(configuredProducts, nextSnapshot.productId);
            const monthlyMeteringActive =
              product?.interval === "month" &&
              !!product.meterPriceIds &&
              Object.keys(product.meterPriceIds).length > 0;
            const note =
              product?.interval === "year"
                ? "In this demo, Stripe metered token and API-call overage is attached to the monthly Pro and Business subscriptions only. Yearly products currently preview fixed recurring pricing and seat add-ons."
                : monthlyMeteringActive
                  ? "This preview comes from Stripe's upcoming invoice API and includes fixed subscription charges, seat add-ons, prorations, and any metered overage recorded so far this billing period."
                  : null;
            const previewCustomerId = nextSnapshot.stripeCustomerId ?? snapshot.stripeCustomerId;
            const previewSubscriptionId =
              nextSnapshot.stripeSubscriptionId ?? snapshot.stripeSubscriptionId;

            if (!previewCustomerId || !previewSubscriptionId) {
              return Response.json(
                {
                  error:
                    "The active billing owner does not have a Stripe subscription available for invoice preview.",
                },
                {
                  status: 400,
                },
              );
            }

            let preview: StripeUpcomingInvoicePreview;
            if (typeof instance.previewUpcomingInvoice === "function") {
              preview = await instance.previewUpcomingInvoice({
                customerId: previewCustomerId,
                subscriptionId: previewSubscriptionId,
                product,
              });
            } else if (stripeSdk) {
              preview = await createStripeUpcomingInvoicePreviewFromSdk({
                stripe: stripeSdk,
                customerId: previewCustomerId,
                subscriptionId: previewSubscriptionId,
                product,
              });
            } else {
              return Response.json(
                {
                  error:
                    "Upcoming invoice previews require either a real Stripe SDK instance or an adapter that supports previewUpcomingInvoice().",
                },
                {
                  status: 501,
                },
              );
            }

            return Response.json({
              planId: nextSnapshot.planId,
              productId: nextSnapshot.productId,
              customerId: previewCustomerId,
              subscriptionId: previewSubscriptionId,
              subscriptionStatus: nextSnapshot.status,
              nextBillingAt: nextSnapshot.currentPeriodEnd?.toISOString() ?? null,
              currency: preview.currency,
              generatedAt: new Date().toISOString(),
              monthlyMeteringActive,
              note,
              totals: preview.totals,
              lines: preview.lines,
            } satisfies StripeBillingUpcomingInvoiceResult);
          },
        },
      ),
      integrationRoute.post<
        typeof reportUsagePath,
        StripeBillingReportUsageInput,
        StripeBillingReportUsageResult
      >(reportUsagePath, {
        responseFormat: "json",
        async handler(request, context) {
          if (!input.billing) {
            return Response.json(
              {
                error: "Stripe billing is not configured for this integration.",
              },
              {
                status: 400,
              },
            );
          }

          const owner = await input.billing.resolveOwner(context);
          if (!owner) {
            return Response.json(
              {
                error: "You need to sign in before reporting Stripe meter usage.",
              },
              {
                status: 401,
              },
            );
          }

          const body = await readJsonObject(request);
          const key = typeof body.key === "string" ? body.key.trim() : "";
          const quantity =
            typeof body.quantity === "number" && Number.isFinite(body.quantity)
              ? body.quantity
              : Number.NaN;
          const idempotencyKey =
            typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

          if (!key) {
            return Response.json(
              {
                error: "Stripe billing usage reporting requires a key.",
              },
              {
                status: 400,
              },
            );
          }

          if (!Number.isFinite(quantity) || quantity <= 0) {
            return Response.json(
              {
                error: "Stripe billing usage reporting requires a quantity greater than zero.",
              },
              {
                status: 400,
              },
            );
          }

          if (!idempotencyKey) {
            return Response.json(
              {
                error: "Stripe billing usage reporting requires an idempotencyKey.",
              },
              {
                status: 400,
              },
            );
          }

          const meter = getBillingMeter(input.billing, key);
          if (!meter) {
            return Response.json(
              {
                error: `Stripe billing meter "${key}" is not configured.`,
              },
              {
                status: 404,
              },
            );
          }

          let occurredAt: string;
          try {
            occurredAt = resolveOccurredAt(body.occurredAt);
          } catch (error) {
            return Response.json(
              {
                error:
                  error instanceof Error
                    ? error.message
                    : "Stripe billing usage reporting received an invalid occurredAt timestamp.",
              },
              {
                status: 400,
              },
            );
          }

          const persistence = resolveBillingPersistence(
            input.billing,
            context,
            stripeSdk,
            integrationSchema,
          );
          const getBillingAccount = requireBillingMethod(
            persistence.getBillingAccount,
            "getBillingAccount",
          );
          const snapshot = await getBillingAccount(owner);
          const stripeCustomerId = snapshot?.stripeCustomerId;

          if (!stripeCustomerId) {
            return Response.json(
              {
                error:
                  "The active billing owner does not have a Stripe customer yet. Subscribe first before reporting meter usage.",
              },
              {
                status: 400,
              },
            );
          }

          if (typeof instance.reportUsage !== "function") {
            throw new Error(
              "Stripe meter usage reporting requires an adapter that supports reportUsage.",
            );
          }

          try {
            let currentPeriodUsed: number | null = null;
            let projectedCurrentPeriodUsed: number | null = null;
            let softLimit: number | null = null;
            let hardLimit: number | null = null;
            let state: StripeBillingMeterState | undefined;
            let warning: string | null = null;
            let pendingProjectionContext: {
              customerId: string;
              currentPeriodStart: string | null;
              currentPeriodEnd: string | null;
            } | null = null;

            if ((meter.guard?.blockOnPastDue ?? true) && snapshot) {
              const blockedByStatus = evaluateStripeMeterUsage({
                meter,
                billingStatus: snapshot.status,
                attached: true,
                currentPeriodUsed: 0,
                includedLimit: getBillingLimitForKey(input.billing, snapshot.planId, snapshot, key),
                softLimit: resolveMeterSoftLimit(
                  input.billing,
                  meter,
                  snapshot.planId,
                  snapshot,
                  key,
                  getBillingLimitForKey(input.billing, snapshot.planId, snapshot, key),
                ),
                hardLimit: resolveMeterHardLimit(
                  meter,
                  snapshot.planId,
                  getBillingLimitForKey(input.billing, snapshot.planId, snapshot, key),
                ),
              });

              if (blockedByStatus.state === "blocked_past_due") {
                return Response.json(
                  {
                    error: blockedByStatus.warning,
                  },
                  {
                    status: 400,
                  },
                );
              }
            }

            if (stripeSdk && snapshot) {
              const prepared = await prepareStripeMeterContext({
                owner,
                key,
                snapshot,
                billing: input.billing,
                products: configuredProducts,
                persistence,
                stripeSdk,
                instance,
              });

              if (!prepared.attachedPriceId) {
                return Response.json(
                  {
                    error: `The current subscription product "${prepared.snapshot.productId ?? "unknown"}" does not have a metered price configured for "${key}".`,
                  },
                  {
                    status: 400,
                  },
                );
              }

              const stripeCurrentPeriodUsed = await loadStripeMeterCurrentPeriodUsage({
                stripeSdk,
                meterId: prepared.meterId,
                customerId: prepared.snapshot.stripeCustomerId ?? stripeCustomerId,
                currentPeriodStart: prepared.currentPeriodStart,
                currentPeriodEnd: prepared.currentPeriodEnd,
              });
              currentPeriodUsed = resolveEffectiveStripeMeterCurrentPeriodUsed({
                customerId: prepared.snapshot.stripeCustomerId ?? stripeCustomerId,
                key,
                currentPeriodStart: prepared.currentPeriodStart,
                currentPeriodEnd: prepared.currentPeriodEnd,
                currentPeriodUsed: stripeCurrentPeriodUsed,
              });
              const includedLimit = getBillingLimitForKey(
                input.billing,
                prepared.snapshot.planId,
                prepared.snapshot,
                key,
              );
              softLimit = resolveMeterSoftLimit(
                input.billing,
                meter,
                prepared.snapshot.planId,
                prepared.snapshot,
                key,
                includedLimit,
              );
              hardLimit = resolveMeterHardLimit(meter, prepared.snapshot.planId, includedLimit);
              const currentEvaluation = evaluateStripeMeterUsage({
                meter,
                billingStatus: prepared.subscriptionStatus,
                attached: prepared.attached,
                currentPeriodUsed,
                includedLimit,
                softLimit,
                hardLimit,
              });

              if (
                currentEvaluation.state === "blocked_past_due" ||
                currentEvaluation.state === "subscription_missing_meter_price" ||
                currentEvaluation.state === "hard_limit_reached"
              ) {
                return Response.json(
                  {
                    error: currentEvaluation.warning,
                  },
                  {
                    status: 400,
                  },
                );
              }

              pendingProjectionContext = {
                customerId: prepared.snapshot.stripeCustomerId ?? stripeCustomerId,
                currentPeriodStart: prepared.currentPeriodStart,
                currentPeriodEnd: prepared.currentPeriodEnd,
              };
              const existingProjection = getPendingStripeMeterProjectionEvent({
                customerId: pendingProjectionContext.customerId,
                key,
                currentPeriodStart: pendingProjectionContext.currentPeriodStart,
                currentPeriodEnd: pendingProjectionContext.currentPeriodEnd,
                identifier: idempotencyKey,
              });

              if (existingProjection) {
                projectedCurrentPeriodUsed = existingProjection.projectedCurrentPeriodUsed;
                const projectedEvaluation = evaluateStripeMeterUsage({
                  meter,
                  billingStatus: prepared.subscriptionStatus,
                  attached: prepared.attached,
                  currentPeriodUsed: projectedCurrentPeriodUsed,
                  includedLimit,
                  softLimit,
                  hardLimit,
                });

                return Response.json({
                  key,
                  quantity: existingProjection.quantity,
                  customerId: prepared.snapshot.stripeCustomerId ?? stripeCustomerId,
                  stripeEventName: meter.eventName,
                  stripeEventIdentifier: idempotencyKey,
                  occurredAt: existingProjection.occurredAt,
                  currentPeriodUsed,
                  projectedCurrentPeriodUsed,
                  softLimit,
                  hardLimit,
                  state: projectedEvaluation.state,
                  warning: projectedEvaluation.warning,
                } satisfies StripeBillingReportUsageResult);
              }

              projectedCurrentPeriodUsed = currentPeriodUsed + quantity;
              if (
                typeof hardLimit === "number" &&
                hardLimit >= 0 &&
                projectedCurrentPeriodUsed > hardLimit
              ) {
                return Response.json(
                  {
                    error: `This usage report would push "${key}" to ${projectedCurrentPeriodUsed.toLocaleString()}, above the configured hard cap of ${hardLimit.toLocaleString()} for the current billing period.`,
                  },
                  {
                    status: 400,
                  },
                );
              }

              const projectedEvaluation = evaluateStripeMeterUsage({
                meter,
                billingStatus: prepared.subscriptionStatus,
                attached: prepared.attached,
                currentPeriodUsed: projectedCurrentPeriodUsed,
                includedLimit,
                softLimit,
                hardLimit,
              });
              state = projectedEvaluation.state;
              warning = projectedEvaluation.warning;
            }

            const reported = await instance.reportUsage({
              customerId: stripeCustomerId,
              key,
              meter,
              quantity,
              idempotencyKey,
              occurredAt,
              properties: normalizeUsageProperties(body.properties),
            });

            await input.billing.hooks?.onUsageReported?.(
              {
                owner,
                key,
                quantity,
                idempotencyKey,
                occurredAt: reported.occurredAt,
                stripeCustomerId: reported.customerId,
                stripeEventName: reported.eventName,
                stripeEventIdentifier: reported.identifier,
                properties: normalizeUsageProperties(body.properties),
              },
              persistence.tools,
            );

            if (pendingProjectionContext && projectedCurrentPeriodUsed != null) {
              rememberPendingStripeMeterProjection({
                customerId: pendingProjectionContext.customerId,
                key,
                currentPeriodStart: pendingProjectionContext.currentPeriodStart,
                currentPeriodEnd: pendingProjectionContext.currentPeriodEnd,
                identifier: reported.identifier,
                quantity,
                occurredAt: reported.occurredAt,
                projectedCurrentPeriodUsed,
              });
            }

            return Response.json({
              key,
              quantity,
              customerId: reported.customerId,
              stripeEventName: reported.eventName,
              stripeEventIdentifier: reported.identifier,
              occurredAt: reported.occurredAt,
              currentPeriodUsed,
              projectedCurrentPeriodUsed,
              softLimit,
              hardLimit,
              state,
              warning,
            } satisfies StripeBillingReportUsageResult);
          } catch (error) {
            return Response.json(
              {
                error:
                  error instanceof Error ? error.message : "Stripe meter usage reporting failed.",
              },
              {
                status: 400,
              },
            );
          }
        },
      }),
      integrationRoute.post<typeof checkPath, StripeBillingCheckInput, StripeBillingCheckResult>(
        checkPath,
        {
          responseFormat: "json",
          async handler(request, context) {
            if (!input.billing) {
              return Response.json(
                {
                  error: "Stripe billing is not configured for this integration.",
                },
                {
                  status: 400,
                },
              );
            }

            const owner = await input.billing.resolveOwner(context);
            if (!owner) {
              return Response.json(
                {
                  error: "You need to sign in before checking billing limits.",
                },
                {
                  status: 401,
                },
              );
            }

            const body = await readJsonObject(request);
            const key = typeof body.key === "string" ? body.key.trim() : "";
            const amount =
              typeof body.amount === "number" && Number.isFinite(body.amount) ? body.amount : 1;

            if (!key) {
              return Response.json(
                {
                  error: "Stripe billing check requires a key.",
                },
                {
                  status: 400,
                },
              );
            }

            if (amount <= 0) {
              return Response.json(
                {
                  error: "Stripe billing check amount must be greater than zero.",
                },
                {
                  status: 400,
                },
              );
            }

            const persistence = resolveBillingPersistence(
              input.billing,
              context,
              stripeSdk,
              integrationSchema,
            );
            const getBillingAccount = requireBillingMethod(
              persistence.getBillingAccount,
              "getBillingAccount",
            );
            const snapshot = await getBillingAccount(owner);
            const planId = snapshot?.planId ?? "free";
            const limit = getBillingLimitForKey(input.billing, planId, snapshot, key);

            if (limit === null) {
              return Response.json(
                {
                  error: `Stripe billing limit "${key}" is not defined on plan "${planId}".`,
                },
                {
                  status: 404,
                },
              );
            }

            const used = await resolveBillingUsage(input.billing, owner, key, persistence.tools);

            const meter = getBillingMeter(input.billing, key);
            const blockedByMeterStatus =
              meter &&
              snapshot &&
              (meter.guard?.blockOnPastDue ?? true) &&
              isPastDueBillingStatus(snapshot.status);

            if (limit >= 0 && used === null) {
              return Response.json(
                {
                  error: `Stripe billing usage did not resolve a numeric value for "${key}".`,
                },
                {
                  status: 400,
                },
              );
            }

            return Response.json({
              planId,
              key,
              amount,
              used,
              limit,
              remaining: typeof used === "number" && limit >= 0 ? Math.max(0, limit - used) : null,
              allowed: blockedByMeterStatus
                ? false
                : limit < 0 || used === null
                  ? true
                  : used + amount <= limit,
            } satisfies StripeBillingCheckResult);
          },
        },
      ),
      integrationRoute.post<typeof checkoutPath, StripeCheckoutInput, StripeCheckoutResult>(
        checkoutPath,
        {
          responseFormat: "json",
          async handler(request, context) {
            const body = await readJsonObject(request);
            const productId = typeof body.productId === "string" ? body.productId : "";
            if (!productId) {
              return Response.json(
                {
                  error: "Stripe checkout requires a productId.",
                },
                {
                  status: 400,
                },
              );
            }

            try {
              const product = getProduct(configuredProducts, productId);
              const billingOwner = input.billing ? await input.billing.resolveOwner(context) : null;
              if (input.billing && !billingOwner) {
                return Response.json(
                  {
                    error: "You need to sign in before starting a Stripe checkout.",
                  },
                  {
                    status: 401,
                  },
                );
              }

              const persistence = resolveBillingPersistence(
                input.billing,
                context,
                stripeSdk,
                integrationSchema,
              );
              const existingSnapshot =
                input.billing && billingOwner && persistence.getBillingAccount
                  ? await persistence.getBillingAccount(billingOwner)
                  : null;
              const resolvedPlanId = resolvePlanIdForProduct(product, existingSnapshot);
              const trialBehavior = normalizeCheckoutTrialBehavior(body.trialBehavior);
              const quantity = resolveQuantity(
                typeof body.quantity === "number" ? body.quantity : undefined,
                product.quantity ?? 1,
              );
              const checkoutLineItems = resolveCheckoutLineItems(
                product,
                quantity,
                input.billing,
                resolvedPlanId,
              );
              const successUrl = resolveCheckoutSuccessUrl(
                resolvePath(
                  typeof body.successPath === "string" ? body.successPath : undefined,
                  "Stripe checkout successPath",
                  successPath,
                ),
                context.request,
                env.appBaseUrl,
              );
              const cancelUrl = resolveAbsoluteDestination(
                resolvePath(
                  typeof body.cancelPath === "string" ? body.cancelPath : undefined,
                  "Stripe checkout cancelPath",
                  cancelPath,
                ),
                context.request,
                env.appBaseUrl,
              );
              const ensuredCustomer =
                input.billing && billingOwner
                  ? await requireBillingMethod(
                      persistence.ensureCustomer,
                      "ensureCustomer",
                    )(billingOwner)
                  : null;
              const resolvedTrial =
                input.billing && billingOwner && trialBehavior !== "none"
                  ? await resolveCheckoutTrial(
                      input.billing,
                      billingOwner,
                      product,
                      existingSnapshot,
                      persistence.tools,
                    )
                  : null;
              if (trialBehavior === "require" && !resolvedTrial) {
                return Response.json(
                  {
                    error:
                      "This billing owner is not eligible for a free trial on the selected product.",
                  },
                  {
                    status: 400,
                  },
                );
              }
              const metadata =
                body.metadata && typeof body.metadata === "object"
                  ? Object.fromEntries(
                      Object.entries(body.metadata as Record<string, unknown>).flatMap(
                        ([key, value]) =>
                          typeof value === "string" ? [[key, value] as const] : [],
                      ),
                    )
                  : {};

              const session = await instance.createCheckoutSession({
                product,
                quantity,
                lineItems: checkoutLineItems,
                customerId: ensuredCustomer?.customerId,
                customerEmail:
                  billingOwner?.email ??
                  (typeof body.customerEmail === "string" ? body.customerEmail : undefined),
                successUrl,
                cancelUrl,
                trialDays: resolvedTrial?.days ?? null,
                metadata: {
                  ...metadata,
                  planId: resolvedPlanId,
                  productId: product.id,
                  ...(billingOwner
                    ? {
                        ownerId: billingOwner.id,
                        ownerKind: billingOwner.kind,
                      }
                    : {}),
                },
                allowPromotionCodes: input.allowPromotionCodes,
                automaticTax: input.automaticTax,
              });

              const result = {
                productId: product.id,
                planId: resolvedPlanId,
                sessionId: session.id,
                redirectTo: session.url,
                mode: product.mode ?? "payment",
                trialApplied: Boolean(resolvedTrial),
                trialDays: resolvedTrial?.days ?? null,
              } satisfies StripeCheckoutResult;

              if (input.billing && billingOwner) {
                await input.billing.hooks?.onCheckoutCreated?.(
                  {
                    owner: billingOwner,
                    planId: resolvedPlanId,
                    productId: product.id,
                    sessionId: result.sessionId,
                    redirectTo: result.redirectTo,
                    trialApplied: result.trialApplied,
                    trialDays: result.trialDays,
                  },
                  persistence.tools,
                );
              }

              if (request.headers.get("x-farm-integration-client") === "1") {
                return Response.json(result);
              }

              return Response.redirect(result.redirectTo, 303);
            } catch (error) {
              return Response.json(
                {
                  error: error instanceof Error ? error.message : "Stripe checkout failed.",
                },
                {
                  status: 400,
                },
              );
            }
          },
        },
      ),
      integrationRoute.post<
        typeof upgradePath,
        StripeBillingUpgradeInput,
        StripeBillingUpgradeResult
      >(upgradePath, {
        responseFormat: "json",
        async handler(request, context) {
          if (!input.billing) {
            return Response.json(
              {
                error: "Stripe billing is not configured for this integration.",
              },
              {
                status: 400,
              },
            );
          }

          const owner = await input.billing.resolveOwner(context);
          if (!owner) {
            return Response.json(
              {
                error: "You need to sign in before upgrading a Stripe subscription.",
              },
              {
                status: 401,
              },
            );
          }

          try {
            const body = await readJsonObject(request);
            const quantity = resolveQuantity(
              typeof body.quantity === "number" ? body.quantity : undefined,
              Number.NaN,
            );
            const prorationBehavior = normalizeProrationBehavior(body.prorationBehavior);
            const persistence = resolveBillingPersistence(
              input.billing,
              context,
              stripeSdk,
              integrationSchema,
            );
            const getBillingAccount = requireBillingMethod(
              persistence.getBillingAccount,
              "getBillingAccount",
            );
            const existingSnapshot = await getBillingAccount(owner);

            if (!existingSnapshot?.stripeSubscriptionId) {
              return Response.json(
                {
                  error:
                    "The active billing owner does not have a Stripe subscription yet. Subscribe first before upgrading seats.",
                },
                {
                  status: 400,
                },
              );
            }

            const product = findConfiguredProduct(configuredProducts, existingSnapshot.productId);
            if (!product || product.kind !== "subscription") {
              return Response.json(
                {
                  error:
                    "The active billing owner is not linked to a configurable subscription product.",
                },
                {
                  status: 400,
                },
              );
            }

            if (product.seatBilling === "included_plus_add_on") {
              const includedSeats = getConfiguredSeatBaseLimit(input.billing, product);
              if (includedSeats === null) {
                return Response.json(
                  {
                    error:
                      "This subscription product does not have a valid included seat limit configured.",
                  },
                  {
                    status: 400,
                  },
                );
              }

              if (quantity < includedSeats) {
                return Response.json(
                  {
                    error: `This plan already includes ${includedSeats} seats, so the total seat quantity cannot be set lower than ${includedSeats}.`,
                  },
                  {
                    status: 400,
                  },
                );
              }

              if (quantity > includedSeats && !product.seatPriceId) {
                return Response.json(
                  {
                    error: `Stripe extra-seat pricing is not configured for "${product.id}" yet. Add the matching seat price ID before trying to purchase more seats.`,
                  },
                  {
                    status: 400,
                  },
                );
              }
            }

            const currentSeatUsage = await resolveBillingUsage(
              input.billing,
              owner,
              "seats",
              persistence.tools,
            );
            if (typeof currentSeatUsage === "number" && currentSeatUsage > quantity) {
              return Response.json(
                {
                  error: `This organization is currently using ${currentSeatUsage} seats. Reduce usage before lowering purchased seats below that value.`,
                },
                {
                  status: 400,
                },
              );
            }

            if (typeof instance.updateSubscription !== "function") {
              throw new Error(
                "Stripe subscription changes require an adapter that supports updateSubscription.",
              );
            }

            const lineItems = resolveCheckoutLineItems(
              product,
              quantity,
              input.billing,
              existingSnapshot.planId,
            );
            const updatedSubscription = await instance.updateSubscription({
              subscriptionId: existingSnapshot.stripeSubscriptionId,
              product,
              lineItems,
              prorationBehavior,
            });

            const nextSnapshot = createBillingSnapshotFromSubscriptionChange(
              owner,
              updatedSubscription,
              input.billing,
              configuredProducts,
              existingSnapshot,
            );

            await persistBillingSnapshot(
              nextSnapshot,
              input.billing,
              persistence,
              existingSnapshot,
            );

            return Response.json({
              planId: nextSnapshot.planId,
              productId: nextSnapshot.productId,
              status: nextSnapshot.status,
              stripeCustomerId: nextSnapshot.stripeCustomerId,
              stripeSubscriptionId: nextSnapshot.stripeSubscriptionId ?? "",
              currentPeriodEnd: nextSnapshot.currentPeriodEnd?.toISOString() ?? null,
              cancelAtPeriodEnd: nextSnapshot.cancelAtPeriodEnd,
              seatQuantity: nextSnapshot.seatQuantity,
            } satisfies StripeBillingUpgradeResult);
          } catch (error) {
            return Response.json(
              {
                error:
                  error instanceof Error ? error.message : "Stripe subscription upgrade failed.",
              },
              {
                status: 400,
              },
            );
          }
        },
      }),
      integrationRoute.post<typeof portalPath, StripePortalInput, StripePortalResult>(portalPath, {
        responseFormat: "json",
        async handler(request, context) {
          const body = await readJsonObject(request);
          try {
            let customerId = typeof body.customerId === "string" ? body.customerId : undefined;

            const persistence = resolveBillingPersistence(
              input.billing,
              context,
              stripeSdk,
              integrationSchema,
            );

            if (!customerId && typeof body.sessionId === "string") {
              const session = await instance.retrieveCheckoutSession(body.sessionId);
              customerId = session.customerId ?? undefined;
            }

            if (!customerId && input.billing) {
              const owner = await input.billing.resolveOwner(context);
              if (owner) {
                const getBillingAccount = requireBillingMethod(
                  persistence.getBillingAccount,
                  "getBillingAccount",
                );
                const snapshot = await getBillingAccount(owner);
                customerId = snapshot?.stripeCustomerId ?? undefined;
              }
            }

            if (!customerId) {
              return Response.json(
                {
                  error: "Stripe portal requires a customerId or a sessionId with a customer.",
                },
                {
                  status: 400,
                },
              );
            }

            const returnUrl = resolveAbsoluteDestination(
              resolvePath(
                typeof body.returnTo === "string" ? body.returnTo : undefined,
                "Stripe portal returnTo",
                successPath,
              ),
              context.request,
              env.appBaseUrl,
              typeof body.sessionId === "string"
                ? {
                    session_id: body.sessionId,
                  }
                : undefined,
            );
            const portal = await instance.createPortalSession({
              customerId,
              returnUrl,
            });
            const result = {
              customerId,
              redirectTo: portal.url,
            } satisfies StripePortalResult;

            if (request.headers.get("x-farm-integration-client") === "1") {
              return Response.json(result);
            }

            return Response.redirect(result.redirectTo, 303);
          } catch (error) {
            return Response.json(
              {
                error: error instanceof Error ? error.message : "Stripe customer portal failed.",
              },
              {
                status: 400,
              },
            );
          }
        },
      }),
      integrationRoute.get<typeof sessionPath, StripeSessionResult, StripeSessionQuery>(
        sessionPath,
        {
          responseFormat: "json",
          async handler(request, context) {
            const sessionId = new URL(request.url).searchParams.get("sessionId");
            if (!sessionId) {
              return Response.json(
                {
                  error: "Stripe session lookup requires sessionId.",
                },
                {
                  status: 400,
                },
              );
            }

            try {
              const session = await instance.retrieveCheckoutSession(sessionId);

              if (input.billing) {
                const persistence = resolveBillingPersistence(
                  input.billing,
                  context,
                  stripeSdk,
                  integrationSchema,
                );
                const snapshot = await resolveBillingSnapshotForSession(
                  session,
                  configuredProducts,
                  input.billing,
                  persistence,
                  context,
                );

                if (snapshot) {
                  const previousSnapshot =
                    session.customerId && persistence.getBillingAccountByStripeCustomerId
                      ? await persistence.getBillingAccountByStripeCustomerId(session.customerId)
                      : null;
                  await persistBillingSnapshot(
                    snapshot,
                    input.billing,
                    persistence,
                    previousSnapshot,
                  );
                  await input.billing.hooks?.onCheckoutCompleted?.(
                    {
                      ...snapshot,
                      sessionId: session.id,
                    },
                    persistence.tools,
                  );
                }
              }

              return Response.json(session);
            } catch (error) {
              return Response.json(
                {
                  error: error instanceof Error ? error.message : "Stripe session lookup failed.",
                },
                {
                  status: 404,
                },
              );
            }
          },
        },
      ),
      ...webhookRoutes,
    ],
  });
}
