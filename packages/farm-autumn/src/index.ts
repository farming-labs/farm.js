import { Autumn as AutumnSDK } from "autumn-js";
import type {
  AttachResponse,
  Balance,
  CheckResponse,
  Customer,
  Item,
  Plan,
  PlanItemPrice,
} from "autumn-js";
import {
  Webhook as StandardWebhook,
  WebhookVerificationError as StandardWebhookVerificationError,
} from "standardwebhooks";
import {
  defineIntegration,
  integrationRoute,
  type FarmIntegration,
  type FarmIntegrationAPI,
  type FarmIntegrationHandlerContext,
  type FarmIntegrationLogger,
} from "@farm.js/core";
import {
  integrationConfig,
  normalizeWebhookConfig,
  resolveAppPath,
  toAbsoluteUrl,
} from "@farm.js/integration-utils";
import type {
  FarmWebhookAckResult,
  FarmWebhookConfig,
  FarmWebhookEvent,
} from "@farm.js/integration-utils/webhooks";
import {
  autumnClient,
  createAutumnClientApi,
  type AutumnBillingCheckInput,
  type AutumnBillingCheckResult,
  type AutumnBillingCurrentChargeLine,
  type AutumnBillingCurrentChargesResult,
  type AutumnBillingFeaturesResult,
  type AutumnBillingInvoicesResult,
  type AutumnBillingInvoice,
  type AutumnBillingLimitsResult,
  type AutumnBillingMeterState,
  type AutumnBillingMeterUsageInput,
  type AutumnBillingMeterUsageResult,
  type AutumnBillingProductKind,
  type AutumnBillingReportUsageInput,
  type AutumnBillingReportUsageResult,
  type AutumnBillingStatus,
  type AutumnBillingStatusResult,
  type AutumnBillingUsageInput,
  type AutumnBillingUsageProperties,
  type AutumnBillingUsageResult,
  type AutumnCatalogMeterPrice,
  type AutumnCatalogProduct,
  type AutumnClientAPI,
  type AutumnClientPathOptions,
  type AutumnDefaultClientAPI,
  type AutumnCheckoutInput,
  type AutumnCheckoutResult,
  type AutumnPortalInput,
  type AutumnPortalResult,
} from "./client.js";

export type {
  AutumnBillingCheckInput,
  AutumnBillingCheckResult,
  AutumnBillingCurrentChargeLine,
  AutumnBillingCurrentChargesResult,
  AutumnBillingFeaturesResult,
  AutumnBillingInvoice,
  AutumnBillingInvoicesResult,
  AutumnBillingLimitsResult,
  AutumnBillingMeterState,
  AutumnBillingMeterUsageInput,
  AutumnBillingMeterUsageResult,
  AutumnBillingReportUsageInput,
  AutumnBillingReportUsageResult,
  AutumnBillingStatusResult,
  AutumnBillingUsageInput,
  AutumnBillingUsageProperties,
  AutumnBillingUsageResult,
  AutumnCatalogMeterPrice,
  AutumnCatalogProduct,
  AutumnCheckoutInput,
  AutumnCheckoutResult,
  AutumnClientAPI,
  AutumnDefaultClientAPI,
  AutumnPortalInput,
  AutumnPortalResult,
} from "./client.js";
export { autumnClient } from "./client.js";

type AutumnWebhookPayload = {
  type: string;
  data?: unknown;
  [key: string]: unknown;
};

export interface AutumnWebhookEvent extends FarmWebhookEvent<
  "autumn",
  string,
  unknown,
  AutumnWebhookPayload
> {}

export type AutumnWebhookConfig = FarmWebhookConfig<AutumnWebhookEvent>;

export type AutumnBillingOwner = {
  kind: "user" | "organization";
  id: string;
  email?: string;
  name?: string;
  fingerprint?: string;
  metadata?: Record<string, string>;
};

export type AutumnBillingFeatures = Record<string, boolean>;
export type AutumnBillingLimits = Record<string, number>;
export type AutumnBillingEntitlements = Record<string, unknown>;
export type AutumnBillingMeterAggregation = "sum" | "count" | "last";
export type AutumnBillingMeterIngestion = "raw" | "pre_aggregated";
export interface AutumnBillingPlanLimitReference {
  planId: string;
  key?: string;
}
export type AutumnBillingSoftLimit =
  | "plan_limit"
  | number
  | AutumnBillingPlanLimitReference
  | `plans.${string}.limit.${string}`
  | `plans.${string}.limits.${string}`;

export interface AutumnBillingPlan {
  public?: boolean;
  features?: AutumnBillingFeatures;
  limits?: AutumnBillingLimits;
  entitlements?: AutumnBillingEntitlements;
  trial?: {
    days: number;
    oncePerOwner?: boolean;
  };
}

export interface AutumnBillingMeterGuard {
  softLimit?: AutumnBillingSoftLimit;
  hardLimit?: number;
  hardOverage?: number;
  hardLimitByPlan?: Record<string, number>;
  hardOverageByPlan?: Record<string, number>;
  blockOnPastDue?: boolean;
}

export interface AutumnBillingMeter {
  aggregation: AutumnBillingMeterAggregation;
  ingestion?: AutumnBillingMeterIngestion;
  window?: "hour" | "day";
  eventName?: string;
  unit?: string;
  featureId?: string;
  guard?: AutumnBillingMeterGuard;
}

export interface AutumnBillingProductAutumnItemPrice {
  amount?: number;
  interval: string;
  intervalCount?: number;
  billingUnits?: number;
  billingMethod: string;
  maxPurchase?: number;
}

export interface AutumnBillingProductAutumnItem {
  featureId: string;
  included?: number;
  unlimited?: boolean;
  reset?: {
    interval: string;
    intervalCount?: number;
  };
  price?: AutumnBillingProductAutumnItemPrice;
  proration?: {
    onIncrease: string;
    onDecrease: string;
  };
  rollover?: {
    max?: number;
    maxPercentage?: number;
    expiryDurationType: string;
    expiryDurationLength?: number;
  };
}

export interface AutumnBillingProductAutumnOptions {
  planId?: string;
  featureQuantities?: Record<string, number>;
  items?: AutumnBillingProductAutumnItem[];
}

export interface AutumnBillingProduct {
  public?: boolean;
  name?: string;
  description?: string;
  kind: AutumnBillingProductKind;
  planId?: string;
  autumn?: AutumnBillingProductAutumnOptions;
  autumnPlanId?: string;
  currency?: string;
  unitAmount?: number;
  interval?: "day" | "week" | "month" | "year";
  intervalCount?: number;
  metadata?: Record<string, string>;
}

export interface AutumnBillingHookTools {
  ctx: FarmIntegrationHandlerContext;
  autumn: AutumnSDK;
}

export interface AutumnBillingUsageOptions {
  resolve(
    owner: AutumnBillingOwner,
    key: string,
    tools: AutumnBillingHookTools,
  ): Promise<number | null> | number | null;
}

export interface AutumnBillingHooks {
  onUsageReported?(
    payload: {
      owner: AutumnBillingOwner;
      key: string;
      quantity: number;
      idempotencyKey: string;
      occurredAt: string;
      eventName: string;
      customerId: string | null;
      projectedCurrentPeriodUsed: number | null;
    },
    tools: AutumnBillingHookTools,
  ): Promise<void> | void;
}

export interface AutumnBillingOptions {
  resolveOwner(
    context: FarmIntegrationHandlerContext,
  ): Promise<AutumnBillingOwner | null> | AutumnBillingOwner | null;
  resolveExternalCustomerId?(
    owner: AutumnBillingOwner,
    tools: AutumnBillingHookTools,
  ): Promise<string> | string;
  plans?: Record<string, AutumnBillingPlan>;
  products?: Record<string, AutumnBillingProduct>;
  usage?: AutumnBillingUsageOptions;
  meters?: Record<string, AutumnBillingMeter>;
  hooks?: AutumnBillingHooks;
}

export interface AutumnIntegrationInput extends AutumnClientPathOptions {
  instance?: AutumnSDK;
  secretKey?: string;
  serverURL?: string;
  appBaseUrl?: string;
  webhooks?: AutumnWebhookConfig;
  billing: AutumnBillingOptions;
  log?: FarmIntegrationLogger;
}

interface ResolvedAutumnConfig {
  secretKey?: string;
  serverURL?: string;
  appBaseUrl?: string;
  webhookSecret?: string;
}

interface ResolvedAutumnProduct extends AutumnBillingProduct {
  id: string;
  public: boolean;
  autumnPlanId: string;
}

type AutumnAttachCustomizeItems = NonNullable<
  NonNullable<Parameters<AutumnSDK["billing"]["attach"]>[0]["customize"]>["items"]
>;
type AutumnUpdateCustomizeItems = NonNullable<
  NonNullable<Parameters<AutumnSDK["billing"]["update"]>[0]["customize"]>["items"]
>;

const pendingAutumnMeterProjection = new Map<string, number>();

type ResolvedAutumnIntegrationPath<
  TPath extends string | undefined,
  TDefault extends string,
> = TPath extends string ? TPath : TDefault;

type AutumnResolvedApiInput<TInput extends AutumnIntegrationInput> = {
  readonly productsPath: ResolvedAutumnIntegrationPath<TInput["productsPath"], "/billing/products">;
  readonly statusPath: ResolvedAutumnIntegrationPath<TInput["statusPath"], "/billing/status">;
  readonly currentChargesPath: ResolvedAutumnIntegrationPath<
    TInput["currentChargesPath"],
    "/billing/current-charges"
  >;
  readonly invoicesPath: ResolvedAutumnIntegrationPath<TInput["invoicesPath"], "/billing/invoices">;
  readonly featuresPath: ResolvedAutumnIntegrationPath<TInput["featuresPath"], "/billing/features">;
  readonly limitsPath: ResolvedAutumnIntegrationPath<TInput["limitsPath"], "/billing/limits">;
  readonly usagePath: ResolvedAutumnIntegrationPath<TInput["usagePath"], "/billing/usage">;
  readonly meterUsagePath: ResolvedAutumnIntegrationPath<
    TInput["meterUsagePath"],
    "/billing/meter-usage"
  >;
  readonly reportUsagePath: ResolvedAutumnIntegrationPath<
    TInput["reportUsagePath"],
    "/billing/report-usage"
  >;
  readonly checkPath: ResolvedAutumnIntegrationPath<TInput["checkPath"], "/billing/check">;
  readonly checkoutPath: ResolvedAutumnIntegrationPath<TInput["checkoutPath"], "/billing/checkout">;
  readonly portalPath: ResolvedAutumnIntegrationPath<TInput["portalPath"], "/billing/portal">;
};

type AutumnDefaultPathInput = {
  productsPath?: undefined;
  statusPath?: undefined;
  currentChargesPath?: undefined;
  invoicesPath?: undefined;
  featuresPath?: undefined;
  limitsPath?: undefined;
  usagePath?: undefined;
  meterUsagePath?: undefined;
  reportUsagePath?: undefined;
  checkPath?: undefined;
  checkoutPath?: undefined;
  portalPath?: undefined;
};

type AutumnIntegrationResult<TApi> = Omit<FarmIntegration, "api"> & {
  api: TApi;
};

function createAutumnApi<
  const TInput extends {
    productsPath: string;
    statusPath: string;
    currentChargesPath: string;
    invoicesPath: string;
    featuresPath: string;
    limitsPath: string;
    usagePath: string;
    meterUsagePath: string;
    reportUsagePath: string;
    checkPath: string;
    checkoutPath: string;
    portalPath: string;
  },
>(input: TInput): AutumnClientAPI<TInput> {
  return createAutumnClientApi(input);
}

function normalizeProducts(products: AutumnBillingOptions["products"]): ResolvedAutumnProduct[] {
  return Object.entries(products ?? {}).map(([id, product]) => {
    const autumnPlanId = product.autumn?.planId ?? product.autumnPlanId;
    if (!autumnPlanId) {
      throw new Error(`Autumn billing product "${id}" requires autumn.planId (or autumnPlanId).`);
    }

    return {
      ...product,
      autumnPlanId,
      id,
      public: product.public ?? true,
    };
  });
}

function toCatalogProduct(
  product: ResolvedAutumnProduct,
  plans: Record<string, AutumnBillingPlan>,
): AutumnCatalogProduct {
  return {
    id: product.id,
    autumnPlanId: product.autumnPlanId,
    name: product.name ?? product.id,
    description: product.description ?? null,
    kind: product.kind,
    planId: product.planId ?? null,
    trialDays: product.planId ? (plans[product.planId]?.trial?.days ?? null) : null,
    public: product.public,
    currency: product.currency ?? null,
    unitAmount: product.unitAmount ?? null,
    interval: product.interval ?? null,
    intervalCount: product.intervalCount ?? null,
    meterPrices: [],
    metadata: product.metadata ?? {},
  };
}

function normalizeAutumnInterval(
  value: string | null | undefined,
): "day" | "week" | "month" | "year" | null {
  switch (value) {
    case "day":
    case "week":
    case "month":
    case "year":
      return value;
    default:
      return null;
  }
}

function formatCatalogMoney(amount: number, currency: string | null): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
    maximumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100);
}

function formatCatalogUnitAmount(value: string, currency: string | null): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(parsed);
}

function projectMeterUsage(input: {
  aggregation: AutumnBillingMeter["aggregation"];
  currentUsed: number;
  quantity: number;
}): number {
  switch (input.aggregation) {
    case "count":
      return input.currentUsed + 1;
    case "last":
      return input.quantity;
    default:
      return input.currentUsed + input.quantity;
  }
}

function toCentsFromDollars(amount: number | null | undefined): number | null {
  return typeof amount === "number" && Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function toDecimalStringFromDollars(amount: number | null | undefined): string | null {
  return typeof amount === "number" && Number.isFinite(amount) ? amount.toFixed(6) : null;
}

function priceCapAmount(
  price:
    | {
        amount?: number | null;
        billingUnits?: number | null;
        maxPurchase?: number | null;
      }
    | null
    | undefined,
): number | null {
  if (!price || typeof price.maxPurchase !== "number" || price.maxPurchase <= 0) {
    return null;
  }

  if (typeof price.amount !== "number" || price.amount <= 0) {
    return null;
  }

  const billingUnits =
    typeof price.billingUnits === "number" && price.billingUnits > 0 ? price.billingUnits : 1;
  const cappedBuckets = Math.ceil(price.maxPurchase / billingUnits);
  return Math.round(cappedBuckets * price.amount * 100);
}

function resolveEffectiveLimit(
  planLimit: number | null | undefined,
  granted: number | null | undefined,
): number | null {
  if (typeof planLimit === "number" && typeof granted === "number") {
    return Math.max(planLimit, granted);
  }

  if (typeof planLimit === "number") {
    return planLimit;
  }

  if (typeof granted === "number") {
    return granted;
  }

  return null;
}

function summarizeAutumnCatalogMeterPrice(input: {
  unitAmountDecimal: string | null;
  unit: string | null;
  capAmount: number | null;
  includedUnits: number | null;
  billingUnits: number | null;
  currency: string | null;
}): string | null {
  if (!input.unitAmountDecimal) {
    return null;
  }

  const parts: string[] = [];
  if (typeof input.includedUnits === "number" && input.includedUnits > 0) {
    parts.push(`${input.includedUnits.toLocaleString()} included`);
  }

  const unitLabel =
    typeof input.billingUnits === "number" && input.billingUnits > 1
      ? `${input.billingUnits.toLocaleString()} ${input.unit ?? "units"}`
      : (input.unit ?? "unit");

  parts.push(`${formatCatalogUnitAmount(input.unitAmountDecimal, input.currency)}/${unitLabel}`);

  if (typeof input.capAmount === "number") {
    parts.push(`capped at ${formatCatalogMoney(input.capAmount, input.currency)}`);
  }

  return parts.join(", ");
}

function resolveMeterFeatureId(meter: AutumnBillingMeter | null | undefined): string | null {
  return meter?.featureId?.trim() ? meter.featureId : null;
}

async function listPlansById(sdk: AutumnSDK): Promise<Map<string, Plan>> {
  const response = await sdk.plans.list();
  const byId = new Map<string, Plan>();

  for (const summary of response.list ?? []) {
    const plan = await sdk.plans.get({
      planId: summary.id,
    });
    byId.set(plan.id, plan);
  }

  return byId;
}

function findPlanMeterPrice(
  plan: Plan | null | undefined,
  featureId: string,
): { item: Item; price: PlanItemPrice } | null {
  for (const item of plan?.items ?? []) {
    if (item.featureId !== featureId || !item.price) {
      continue;
    }

    return { item, price: item.price };
  }

  return null;
}

function toAutumnProductItem(item: Item): AutumnBillingProductAutumnItem {
  return {
    featureId: item.featureId,
    included: item.included ?? undefined,
    unlimited: item.unlimited ?? undefined,
    reset: item.reset ?? undefined,
    price: item.price
      ? {
          amount: item.price.amount ?? undefined,
          interval: normalizeAutumnInterval(item.price.interval ?? null) ?? "month",
          intervalCount: item.price.intervalCount ?? undefined,
          billingUnits: item.price.billingUnits ?? undefined,
          billingMethod: item.price.billingMethod,
          maxPurchase: item.price.maxPurchase ?? undefined,
        }
      : undefined,
    rollover: item.rollover
      ? {
          max: item.rollover.max ?? undefined,
          maxPercentage: item.rollover.maxPercentage ?? undefined,
          expiryDurationType: item.rollover.expiryDurationType,
          expiryDurationLength: item.rollover.expiryDurationLength ?? undefined,
        }
      : undefined,
  };
}

function mergeAutumnProductItems(
  livePlan: Plan | null | undefined,
  product: ResolvedAutumnProduct | null | undefined,
): AutumnBillingProductAutumnItem[] {
  const merged = new Map<string, AutumnBillingProductAutumnItem>();

  for (const item of livePlan?.items ?? []) {
    merged.set(item.featureId, toAutumnProductItem(item));
  }

  for (const item of product?.autumn?.items ?? []) {
    const previous = merged.get(item.featureId);
    merged.set(item.featureId, {
      ...previous,
      ...item,
      reset: item.reset ?? previous?.reset,
      price: item.price ?? previous?.price,
      proration: item.proration ?? previous?.proration,
      rollover: item.rollover ?? previous?.rollover,
    });
  }

  return [...merged.values()];
}

function findConfiguredMeterPrice(input: {
  livePlan: Plan | null | undefined;
  product: ResolvedAutumnProduct | null | undefined;
  featureId: string;
}): {
  item: AutumnBillingProductAutumnItem;
  price: AutumnBillingProductAutumnItemPrice;
} | null {
  for (const item of mergeAutumnProductItems(input.livePlan, input.product)) {
    if (item.featureId !== input.featureId || !item.price) {
      continue;
    }

    return {
      item,
      price: item.price,
    };
  }

  return null;
}

async function enrichCatalogProduct(
  sdk: AutumnSDK,
  product: ResolvedAutumnProduct,
  plans: Record<string, AutumnBillingPlan>,
  meters: AutumnBillingOptions["meters"],
  livePlansById: Map<string, Plan>,
): Promise<AutumnCatalogProduct> {
  const base = toCatalogProduct(product, plans);
  const livePlan = livePlansById.get(product.autumnPlanId) ?? null;
  if (!livePlan) {
    return base;
  }

  const meterPrices: AutumnCatalogMeterPrice[] = [];
  for (const [key, meter] of Object.entries(meters ?? {})) {
    const featureId = resolveMeterFeatureId(meter);
    if (!featureId) {
      continue;
    }

    const matched = findConfiguredMeterPrice({
      livePlan,
      product,
      featureId,
    });
    if (!matched) {
      continue;
    }

    const unitAmountDecimal = toDecimalStringFromDollars(matched.price.amount ?? null);
    const capAmount = priceCapAmount(matched.price);
    meterPrices.push({
      key,
      eventName: meter.eventName ?? featureId,
      featureId,
      unit: meter.unit ?? null,
      currency: product.currency ?? "usd",
      unitAmountDecimal,
      capAmount,
      billingUnits: matched.price.billingUnits ?? null,
      includedUnits: matched.item.included ?? null,
      maxPurchaseUnits: matched.price.maxPurchase ?? null,
      summary: summarizeAutumnCatalogMeterPrice({
        unitAmountDecimal,
        unit: meter.unit ?? null,
        capAmount,
        includedUnits: matched.item.included ?? null,
        billingUnits: matched.price.billingUnits ?? null,
        currency: product.currency ?? "usd",
      }),
    });
  }

  return {
    ...base,
    name: livePlan.name || base.name,
    description: livePlan.description ?? base.description,
    trialDays:
      livePlan.freeTrial?.durationType === "day" ? livePlan.freeTrial.durationLength : null,
    currency: base.currency ?? "usd",
    unitAmount: toCentsFromDollars(livePlan.price?.amount) ?? base.unitAmount,
    interval: normalizeAutumnInterval(livePlan.price?.interval ?? null) ?? base.interval,
    intervalCount: livePlan.price?.intervalCount ?? base.intervalCount,
    meterPrices,
  };
}

function getOwnerExternalCustomerId(
  owner: AutumnBillingOwner,
  billing: AutumnBillingOptions,
  tools: AutumnBillingHookTools,
): Promise<string> | string {
  if (billing.resolveExternalCustomerId) {
    return billing.resolveExternalCustomerId(owner, tools);
  }

  const normalizedId = owner.id
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${owner.kind}_${normalizedId || "unknown"}`;
}

function resolveAutumnPlanLimitReference(
  value: AutumnBillingSoftLimit | undefined,
  defaultKey: string,
): AutumnBillingPlanLimitReference | null {
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

function resolveSoftLimit(
  plans: Record<string, AutumnBillingPlan>,
  planId: string,
  key: string,
  includedLimit: number | null,
  guard: AutumnBillingMeterGuard | undefined,
): number | null {
  if (!guard?.softLimit) {
    return null;
  }

  if (guard.softLimit === "plan_limit") {
    return includedLimit;
  }

  const reference = resolveAutumnPlanLimitReference(guard.softLimit, key);
  if (reference) {
    const referencedLimit = plans[reference.planId]?.limits?.[reference.key ?? key] ?? null;
    return typeof referencedLimit === "number" ? referencedLimit : null;
  }

  return typeof guard.softLimit === "number" ? guard.softLimit : null;
}

function resolveHardLimit(
  planId: string,
  includedLimit: number | null,
  guard: AutumnBillingMeterGuard | undefined,
): number | null {
  if (!guard) {
    return null;
  }

  if (typeof guard.hardLimitByPlan?.[planId] === "number") {
    return guard.hardLimitByPlan[planId]!;
  }

  if (typeof guard.hardLimit === "number") {
    return guard.hardLimit;
  }

  if (typeof includedLimit === "number" && typeof guard.hardOverageByPlan?.[planId] === "number") {
    return includedLimit + guard.hardOverageByPlan[planId]!;
  }

  if (typeof includedLimit === "number" && typeof guard.hardOverage === "number") {
    return includedLimit + guard.hardOverage;
  }

  return null;
}

function projectionKey(input: {
  externalCustomerId: string;
  featureId: string;
  currentPeriodEnd: string | null;
}): string {
  return `${input.externalCustomerId}:${input.featureId}:${input.currentPeriodEnd ?? "none"}`;
}

function getProjectedUsage(input: {
  externalCustomerId: string;
  featureId: string;
  currentPeriodEnd: string | null;
  currentPeriodUsed: number;
}): number {
  const key = projectionKey(input);
  const projected = pendingAutumnMeterProjection.get(key);

  if (projected == null) {
    return input.currentPeriodUsed;
  }

  if (input.currentPeriodUsed >= projected) {
    pendingAutumnMeterProjection.delete(key);
    return input.currentPeriodUsed;
  }

  return projected;
}

function setProjectedUsage(input: {
  externalCustomerId: string;
  featureId: string;
  currentPeriodEnd: string | null;
  projectedUsage: number;
}) {
  pendingAutumnMeterProjection.set(projectionKey(input), input.projectedUsage);
}

function normalizeAutumnStatus(
  customer: Customer | null,
  subscription: Customer["subscriptions"][number] | null,
): AutumnBillingStatus {
  if (!customer || !subscription) {
    return "free";
  }

  if (subscription.pastDue) {
    return "past_due";
  }

  if (subscription.canceledAt != null) {
    return "canceled";
  }

  if (subscription.trialEndsAt != null && subscription.trialEndsAt > Date.now()) {
    return "trialing";
  }

  if (subscription.status === "scheduled") {
    return "scheduled";
  }

  return "active";
}

function resolveActiveProduct(
  customer: Customer | null,
  products: readonly ResolvedAutumnProduct[],
): {
  product: ResolvedAutumnProduct | null;
  subscription: Customer["subscriptions"][number] | null;
  purchase: Customer["purchases"][number] | null;
  status: AutumnBillingStatus;
} {
  const byPlanId = new Map<string, ResolvedAutumnProduct>(
    products.map((product) => [product.autumnPlanId, product]),
  );

  const matchedSubscription = [...(customer?.subscriptions ?? [])]
    .filter((entry) => byPlanId.has(entry.planId))
    .sort((left, right) => right.startedAt - left.startedAt)[0];
  if (matchedSubscription) {
    return {
      product: byPlanId.get(matchedSubscription.planId) ?? null,
      subscription: matchedSubscription,
      purchase: null,
      status: normalizeAutumnStatus(customer, matchedSubscription),
    };
  }

  const matchedPurchase = [...(customer?.purchases ?? [])]
    .filter((entry) => byPlanId.has(entry.planId))
    .sort((left, right) => right.startedAt - left.startedAt)[0];
  if (matchedPurchase) {
    return {
      product: byPlanId.get(matchedPurchase.planId) ?? null,
      subscription: null,
      purchase: matchedPurchase,
      status: "active",
    };
  }

  return {
    product: null,
    subscription: null,
    purchase: null,
    status: "free",
  };
}

function currentPeriodStart(subscription: Customer["subscriptions"][number] | null): string | null {
  return subscription?.currentPeriodStart != null
    ? new Date(subscription.currentPeriodStart).toISOString()
    : null;
}

function currentPeriodEnd(subscription: Customer["subscriptions"][number] | null): string | null {
  return subscription?.currentPeriodEnd != null
    ? new Date(subscription.currentPeriodEnd).toISOString()
    : null;
}

function trialEndsAt(subscription: Customer["subscriptions"][number] | null): string | null {
  return subscription?.trialEndsAt != null
    ? new Date(subscription.trialEndsAt).toISOString()
    : null;
}

function computeMeterState(input: {
  currentUsed: number;
  subscriptionStatus: AutumnBillingStatus;
  includedLimit: number | null;
  softLimit: number | null;
  hardLimit: number | null;
  guard: AutumnBillingMeterGuard | undefined;
  featureFound: boolean;
}): {
  state: AutumnBillingMeterState;
  warning: string | null;
} {
  if (!input.featureFound) {
    return {
      state: "meter_missing",
      warning: "The configured Autumn feature is not active for this customer yet.",
    };
  }

  if (input.guard?.blockOnPastDue && input.subscriptionStatus === "past_due") {
    return {
      state: "blocked_past_due",
      warning: "Usage reporting is blocked while the Autumn subscription is past due.",
    };
  }

  if (typeof input.hardLimit === "number" && input.currentUsed >= input.hardLimit) {
    return {
      state: "hard_limit_reached",
      warning: "The configured metered hard cap has been reached for the current billing period.",
    };
  }

  if (typeof input.softLimit === "number" && input.currentUsed >= input.softLimit) {
    return {
      state: "soft_limit_reached",
      warning:
        typeof input.includedLimit === "number"
          ? "Included usage has been exhausted. Additional usage is billable."
          : "The configured soft limit has been reached.",
    };
  }

  return {
    state: "ok",
    warning: null,
  };
}

function resolveUsageValue(input: {
  owner: AutumnBillingOwner;
  key: string;
  tools: AutumnBillingHookTools;
  billing: AutumnBillingOptions;
  customer: Customer | null;
}): Promise<number | null> | number | null {
  if (input.billing.usage) {
    return input.billing.usage.resolve(input.owner, input.key, input.tools);
  }

  const featureId = resolveMeterFeatureId(input.billing.meters?.[input.key] ?? null);
  if (!featureId) {
    return null;
  }

  return input.customer?.balances?.[featureId]?.usage ?? null;
}

function estimateUsageChargeFromBalance(input: {
  balance: Balance | null;
  livePlan: Plan | null;
  featureId: string;
}): {
  chargeSource: "balance" | "catalog_rate";
  unitAmountDecimal: string | null;
  capAmount: number | null;
  billingUnits: number | null;
  estimatedMeterChargeAmount: number | null;
} {
  const balanceBreakdown = input.balance?.breakdown?.find((entry) => entry.price);
  const matched = balanceBreakdown?.price
    ? {
        item: null,
        price: balanceBreakdown.price,
      }
    : findPlanMeterPrice(input.livePlan, input.featureId);
  if (!matched) {
    return {
      chargeSource: "catalog_rate",
      unitAmountDecimal: null,
      capAmount: null,
      billingUnits: null,
      estimatedMeterChargeAmount: null,
    };
  }

  const billingUnits =
    typeof matched.price.billingUnits === "number" && matched.price.billingUnits > 0
      ? matched.price.billingUnits
      : 1;
  const unitAmount = matched.price.amount ?? null;
  const unitAmountDecimal = toDecimalStringFromDollars(unitAmount);
  const capAmount = priceCapAmount(matched.price);

  const balance = input.balance;
  const overageUnits =
    balance && balance.overageAllowed ? Math.max(balance.usage - balance.granted, 0) : 0;
  const billableBuckets = Math.ceil(overageUnits / billingUnits);
  const uncapped =
    typeof unitAmount === "number" && unitAmount > 0
      ? Math.round(billableBuckets * unitAmount * 100)
      : null;

  return {
    chargeSource: balanceBreakdown?.price ? "balance" : "catalog_rate",
    unitAmountDecimal,
    capAmount,
    billingUnits,
    estimatedMeterChargeAmount:
      uncapped == null || capAmount == null ? uncapped : Math.min(uncapped, capAmount),
  };
}

function isPrepaidFeatureQuantity(input: {
  livePlan: Plan | null;
  product: ResolvedAutumnProduct | null | undefined;
  featureId: string;
}): boolean {
  const matched = findConfiguredMeterPrice({
    livePlan: input.livePlan,
    product: input.product,
    featureId: input.featureId,
  });
  return matched?.price.billingMethod === "prepaid";
}

function toCurrentChargeLine(input: {
  key: string | null;
  kind: "base_subscription" | "metered_usage";
  label: string;
  amount: number | null;
  currency: string;
  quantity?: number | null;
  includedUnits?: number | null;
  overageUnits?: number | null;
  billedBuckets?: number | null;
  billingUnits?: number | null;
  unitAmountDecimal?: string | null;
}): AutumnBillingCurrentChargeLine {
  return {
    key: input.key,
    kind: input.kind,
    label: input.label,
    amount: input.amount ?? null,
    currency: input.currency,
    quantity: input.quantity ?? null,
    includedUnits: input.includedUnits ?? null,
    overageUnits: input.overageUnits ?? null,
    billedBuckets: input.billedBuckets ?? null,
    billingUnits: input.billingUnits ?? null,
    unitAmountDecimal: input.unitAmountDecimal ?? null,
  };
}

async function requireOwner(
  ctx: FarmIntegrationHandlerContext,
  billing: AutumnBillingOptions,
  autumn: AutumnSDK,
) {
  const tools: AutumnBillingHookTools = { ctx, autumn };
  const owner = await billing.resolveOwner(ctx);

  if (!owner) {
    throw new Error("Autumn billing owner could not be resolved for this request.");
  }

  const externalCustomerId = await getOwnerExternalCustomerId(owner, billing, tools);
  const customer = await autumn.customers.getOrCreate({
    customerId: externalCustomerId,
    name: owner.name,
    email: owner.email,
    fingerprint: owner.fingerprint,
    metadata: owner.metadata,
  });

  return {
    owner,
    externalCustomerId,
    customer,
    tools,
  };
}

function webhookHeadersToStandardHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });

  if (result["svix-id"] && !result["webhook-id"]) {
    result["webhook-id"] = result["svix-id"];
  }
  if (result["svix-signature"] && !result["webhook-signature"]) {
    result["webhook-signature"] = result["svix-signature"];
  }
  if (result["svix-timestamp"] && !result["webhook-timestamp"]) {
    result["webhook-timestamp"] = result["svix-timestamp"];
  }

  return result;
}

function createStandardWebhook(secret: string) {
  return new StandardWebhook(Buffer.from(secret, "utf-8").toString("base64"));
}

export function autumn<const TInput extends AutumnIntegrationInput & AutumnDefaultPathInput>(
  input: TInput,
): AutumnIntegrationResult<AutumnDefaultClientAPI>;
export function autumn<const TInput extends AutumnIntegrationInput>(
  input: TInput,
): AutumnIntegrationResult<AutumnClientAPI<AutumnResolvedApiInput<TInput>>>;
export function autumn<TInput extends AutumnIntegrationInput>(
  input: TInput,
): AutumnIntegrationResult<FarmIntegrationAPI> {
  const secretKey = input.secretKey ?? process.env.AUTUMN_SECRET_KEY ?? "";
  const appBaseUrl = input.appBaseUrl ?? process.env.APP_BASE_URL ?? undefined;
  const webhookSecret = process.env.AUTUMN_WEBHOOK_SECRET ?? undefined;
  if (!input.instance && !secretKey) {
    throw new Error("Autumn integration requires AUTUMN_SECRET_KEY or an Autumn instance.");
  }

  const billing = input.billing;
  const productsPath = (input.productsPath ?? "/billing/products") as ResolvedAutumnIntegrationPath<
    TInput["productsPath"],
    "/billing/products"
  >;
  const statusPath = (input.statusPath ?? "/billing/status") as ResolvedAutumnIntegrationPath<
    TInput["statusPath"],
    "/billing/status"
  >;
  const currentChargesPath = (input.currentChargesPath ??
    "/billing/current-charges") as ResolvedAutumnIntegrationPath<
    TInput["currentChargesPath"],
    "/billing/current-charges"
  >;
  const invoicesPath = (input.invoicesPath ?? "/billing/invoices") as ResolvedAutumnIntegrationPath<
    TInput["invoicesPath"],
    "/billing/invoices"
  >;
  const featuresPath = (input.featuresPath ?? "/billing/features") as ResolvedAutumnIntegrationPath<
    TInput["featuresPath"],
    "/billing/features"
  >;
  const limitsPath = (input.limitsPath ?? "/billing/limits") as ResolvedAutumnIntegrationPath<
    TInput["limitsPath"],
    "/billing/limits"
  >;
  const usagePath = (input.usagePath ?? "/billing/usage") as ResolvedAutumnIntegrationPath<
    TInput["usagePath"],
    "/billing/usage"
  >;
  const meterUsagePath = (input.meterUsagePath ??
    "/billing/meter-usage") as ResolvedAutumnIntegrationPath<
    TInput["meterUsagePath"],
    "/billing/meter-usage"
  >;
  const reportUsagePath = (input.reportUsagePath ??
    "/billing/report-usage") as ResolvedAutumnIntegrationPath<
    TInput["reportUsagePath"],
    "/billing/report-usage"
  >;
  const checkPath = (input.checkPath ?? "/billing/check") as ResolvedAutumnIntegrationPath<
    TInput["checkPath"],
    "/billing/check"
  >;
  const checkoutPath = (input.checkoutPath ?? "/billing/checkout") as ResolvedAutumnIntegrationPath<
    TInput["checkoutPath"],
    "/billing/checkout"
  >;
  const portalPath = (input.portalPath ?? "/billing/portal") as ResolvedAutumnIntegrationPath<
    TInput["portalPath"],
    "/billing/portal"
  >;
  const webhookDefinitions = normalizeWebhookConfig<AutumnWebhookEvent>({
    webhooks: input.webhooks,
    defaultName: "default",
    defaultPath: "/billing/webhook",
    defaultSecret: webhookSecret,
  });
  const plans = billing.plans ?? {};
  const products = normalizeProducts(billing.products);

  for (const [key, meter] of Object.entries(billing.meters ?? {})) {
    if (!resolveMeterFeatureId(meter)) {
      throw new Error(`Autumn billing meter "${key}" requires a featureId.`);
    }
  }

  const sdk =
    input.instance ??
    new AutumnSDK({
      secretKey,
      serverURL: input.serverURL,
    });

  const webhookRoutes = webhookDefinitions.map((definition) =>
    integrationRoute.post(definition.path, {
      responseFormat: "json",
      rawBody: true,
      async handler(request, context) {
        const rawBody = await request.text();
        const webhookContext = {
          request,
          route: context,
          rawBody,
          headers: request.headers,
          webhook: {
            name: definition.name,
            path: definition.path,
          },
        };

        try {
          if (!definition.secret) {
            throw new Error("Autumn webhook secret is required to verify webhook events.");
          }

          const verifier = createStandardWebhook(definition.secret);
          const payload = verifier.verify(
            rawBody,
            webhookHeadersToStandardHeaders(request.headers),
          ) as unknown as AutumnWebhookPayload;
          const eventId =
            request.headers.get("svix-id") ??
            request.headers.get("webhook-id") ??
            `${payload.type}:${Date.now()}`;
          const event: AutumnWebhookEvent = {
            provider: "autumn",
            id: eventId,
            type: payload.type,
            data: payload.data,
            raw: payload,
          };

          await definition.onEvent?.(event, webhookContext);

          return Response.json({
            received: true,
            provider: "autumn",
            webhook: definition.name,
            eventId: event.id,
            type: event.type,
          } satisfies FarmWebhookAckResult);
        } catch (error) {
          const override = await definition.onError?.(error, webhookContext);
          if (override) {
            return override;
          }

          return Response.json(
            {
              error: error instanceof Error ? error.message : "Autumn webhook verification failed.",
            },
            {
              status: error instanceof StandardWebhookVerificationError ? 403 : 400,
            },
          );
        }
      },
    }),
  );

  return defineIntegration({
    category: "payment",
    type: "autumn",
    instance: {
      products: products.map((product) => ({
        id: product.id,
        autumnPlanId: product.autumnPlanId,
        kind: product.kind,
        planId: product.planId ?? null,
      })),
    },
    config: integrationConfig<ResolvedAutumnConfig>({
      label: "Autumn integration",
      env: {
        secretKey: "AUTUMN_SECRET_KEY",
        appBaseUrl: "APP_BASE_URL",
        webhookSecret: "AUTUMN_WEBHOOK_SECRET",
      },
      input: {
        secretKey,
        serverURL: input.serverURL,
        appBaseUrl,
        webhookSecret,
      },
      required: input.instance ? [] : ["secretKey"],
    }),
    api: createAutumnApi({
      productsPath,
      statusPath,
      currentChargesPath,
      invoicesPath,
      featuresPath,
      limitsPath,
      usagePath,
      meterUsagePath,
      reportUsagePath,
      checkPath,
      checkoutPath,
      portalPath,
    }) as unknown as FarmIntegrationAPI,
    log: input.log,
    routes: [
      integrationRoute.get(productsPath, {
        responseFormat: "json",
        async handler() {
          let livePlansById: Map<string, Plan>;
          try {
            livePlansById = await listPlansById(sdk);
          } catch {
            return Response.json(
              products
                .filter((product) => product.public)
                .map((product) => toCatalogProduct(product, plans)),
            );
          }

          return Response.json(
            await Promise.all(
              products
                .filter((product) => product.public)
                .map((product) =>
                  enrichCatalogProduct(sdk, product, plans, billing.meters, livePlansById),
                ),
            ),
          );
        },
      }),
      integrationRoute.get(statusPath, {
        responseFormat: "json",
        async handler(_request, ctx) {
          const owner = await billing.resolveOwner(ctx);
          if (!owner) {
            const plan = plans.free ?? {};
            return Response.json({
              owner: null,
              externalCustomerId: null,
              customerId: null,
              planId: "free",
              productId: null,
              status: "free",
              subscriptionId: null,
              currentPeriodStart: null,
              currentPeriodEnd: null,
              cancelAtPeriodEnd: false,
              trialEndsAt: null,
              features: plan.features ?? {},
              limits: plan.limits ?? {},
              entitlements: plan.entitlements ?? {},
            } satisfies AutumnBillingStatusResult);
          }

          const resolved = await requireOwner(ctx, billing, sdk);
          const active = resolveActiveProduct(resolved.customer, products);
          const planId = active.product?.planId ?? "free";
          const plan = plans[planId] ?? {};

          return Response.json({
            owner: resolved.owner,
            externalCustomerId: resolved.externalCustomerId,
            customerId: resolved.customer.id,
            planId,
            productId: active.product?.id ?? null,
            status: active.status,
            subscriptionId: active.subscription?.id ?? null,
            currentPeriodStart: currentPeriodStart(active.subscription),
            currentPeriodEnd: currentPeriodEnd(active.subscription),
            cancelAtPeriodEnd:
              active.subscription?.expiresAt != null &&
              (active.subscription.canceledAt == null ||
                active.subscription.canceledAt > Date.now()),
            trialEndsAt: trialEndsAt(active.subscription),
            features: plan.features ?? {},
            limits: plan.limits ?? {},
            entitlements: plan.entitlements ?? {},
          } satisfies AutumnBillingStatusResult);
        },
      }),
      integrationRoute.get(currentChargesPath, {
        responseFormat: "json",
        async handler(_request, ctx) {
          const owner = await billing.resolveOwner(ctx);
          if (!owner) {
            return Response.json({
              owner: null,
              externalCustomerId: null,
              customerId: null,
              planId: "free",
              productId: null,
              subscriptionId: null,
              currency: "usd",
              currentPeriodStart: null,
              currentPeriodEnd: null,
              baseSubscriptionAmount: null,
              pendingMeterChargeAmount: 0,
              estimatedTotalAmount: null,
              lineItems: [],
            } satisfies AutumnBillingCurrentChargesResult);
          }

          const resolved = await requireOwner(ctx, billing, sdk);
          const active = resolveActiveProduct(resolved.customer, products);
          const planId = active.product?.planId ?? "free";
          const plan = plans[planId] ?? {};
          const livePlan = active.product?.autumnPlanId
            ? await sdk.plans.get({ planId: active.product.autumnPlanId })
            : null;
          const currency = active.product?.currency ?? "usd";
          const baseSubscriptionAmount = toCentsFromDollars(livePlan?.price?.amount ?? null);
          const lineItems: AutumnBillingCurrentChargeLine[] = [];

          if (baseSubscriptionAmount != null) {
            lineItems.push(
              toCurrentChargeLine({
                key: null,
                kind: "base_subscription",
                label: active.product?.name ?? "Base subscription",
                amount: baseSubscriptionAmount,
                currency,
              }),
            );
          }

          let pendingMeterChargeAmount = 0;
          let sawMeterLine = false;

          for (const [key, meter] of Object.entries(billing.meters ?? {})) {
            const featureId = resolveMeterFeatureId(meter);
            if (!featureId) {
              continue;
            }

            const balance = resolved.customer.balances?.[featureId] ?? null;
            if (!balance) {
              continue;
            }

            const usedUnits = getProjectedUsage({
              externalCustomerId: resolved.externalCustomerId,
              featureId,
              currentPeriodEnd: currentPeriodEnd(active.subscription),
              currentPeriodUsed: balance.usage ?? 0,
            });
            const includedUnits = plan.limits?.[key] ?? balance.granted ?? null;
            const overageUnits =
              typeof includedUnits === "number" ? Math.max(usedUnits - includedUnits, 0) : null;
            const estimate = estimateUsageChargeFromBalance({
              balance,
              livePlan,
              featureId,
            });
            const billedBuckets =
              typeof overageUnits === "number" &&
              typeof estimate.billingUnits === "number" &&
              estimate.billingUnits > 0
                ? Math.ceil(overageUnits / estimate.billingUnits)
                : 0;

            sawMeterLine = true;
            pendingMeterChargeAmount += estimate.estimatedMeterChargeAmount ?? 0;
            lineItems.push(
              toCurrentChargeLine({
                key,
                kind: "metered_usage",
                label: `${meter.unit ?? key} overage`,
                amount: estimate.estimatedMeterChargeAmount ?? 0,
                currency,
                quantity: usedUnits,
                includedUnits,
                overageUnits,
                billedBuckets,
                billingUnits: estimate.billingUnits,
                unitAmountDecimal: estimate.unitAmountDecimal,
              }),
            );
          }

          return Response.json({
            owner: resolved.owner,
            externalCustomerId: resolved.externalCustomerId,
            customerId: resolved.customer.id,
            planId,
            productId: active.product?.id ?? null,
            subscriptionId: active.subscription?.id ?? null,
            currency,
            currentPeriodStart: currentPeriodStart(active.subscription),
            currentPeriodEnd: currentPeriodEnd(active.subscription),
            baseSubscriptionAmount,
            pendingMeterChargeAmount: sawMeterLine ? pendingMeterChargeAmount : null,
            estimatedTotalAmount:
              (baseSubscriptionAmount ?? 0) + (sawMeterLine ? pendingMeterChargeAmount : 0),
            lineItems,
          } satisfies AutumnBillingCurrentChargesResult);
        },
      }),
      integrationRoute.get(invoicesPath, {
        responseFormat: "json",
        async handler(_request, ctx) {
          const owner = await billing.resolveOwner(ctx);
          if (!owner) {
            return Response.json({
              owner: null,
              externalCustomerId: null,
              customerId: null,
              invoices: [],
            } satisfies AutumnBillingInvoicesResult);
          }

          const resolved = await requireOwner(ctx, billing, sdk);
          const expandedCustomer = await sdk.customers.getOrCreate({
            customerId: resolved.externalCustomerId,
            name: resolved.owner.name,
            email: resolved.owner.email,
            fingerprint: resolved.owner.fingerprint,
            metadata: resolved.owner.metadata,
            expand: ["invoices"],
          });

          const invoices = (expandedCustomer.invoices ?? [])
            .map(
              (invoice) =>
                ({
                  stripeInvoiceId: invoice.stripeId,
                  planIds: invoice.planIds ?? [],
                  status: invoice.status,
                  totalAmount: toCentsFromDollars(invoice.total) ?? 0,
                  currency: invoice.currency ?? "usd",
                  createdAt: new Date(invoice.createdAt).toISOString(),
                  hostedInvoiceUrl: invoice.hostedInvoiceUrl ?? null,
                }) satisfies AutumnBillingInvoice,
            )
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

          return Response.json({
            owner: resolved.owner,
            externalCustomerId: resolved.externalCustomerId,
            customerId: expandedCustomer.id,
            invoices,
          } satisfies AutumnBillingInvoicesResult);
        },
      }),
      integrationRoute.get(featuresPath, {
        responseFormat: "json",
        async handler(_request, ctx) {
          const owner = await billing.resolveOwner(ctx);
          if (!owner) {
            const plan = plans.free ?? {};
            return Response.json({
              planId: "free",
              features: plan.features ?? {},
            } satisfies AutumnBillingFeaturesResult);
          }

          const resolved = await requireOwner(ctx, billing, sdk);
          const active = resolveActiveProduct(resolved.customer, products);
          const planId = active.product?.planId ?? "free";
          const plan = plans[planId] ?? {};

          return Response.json({
            planId,
            features: plan.features ?? {},
          } satisfies AutumnBillingFeaturesResult);
        },
      }),
      integrationRoute.get(limitsPath, {
        responseFormat: "json",
        async handler(_request, ctx) {
          const owner = await billing.resolveOwner(ctx);
          if (!owner) {
            const plan = plans.free ?? {};
            return Response.json({
              planId: "free",
              limits: plan.limits ?? {},
            } satisfies AutumnBillingLimitsResult);
          }

          const resolved = await requireOwner(ctx, billing, sdk);
          const active = resolveActiveProduct(resolved.customer, products);
          const planId = active.product?.planId ?? "free";
          const plan = plans[planId] ?? {};

          return Response.json({
            planId,
            limits: plan.limits ?? {},
          } satisfies AutumnBillingLimitsResult);
        },
      }),
      integrationRoute.post(usagePath, {
        responseFormat: "json",
        async handler(request, ctx) {
          const body = (await request.json().catch(() => ({}))) as AutumnBillingUsageInput;
          if (!body.key) {
            return new Response("A billing usage key is required.", { status: 400 });
          }

          const resolved = await requireOwner(ctx, billing, sdk);
          const active = resolveActiveProduct(resolved.customer, products);
          const planId = active.product?.planId ?? "free";
          const plan = plans[planId] ?? {};
          const featureId = resolveMeterFeatureId(billing.meters?.[body.key] ?? null);
          const granted =
            featureId && resolved.customer.balances?.[featureId]
              ? (resolved.customer.balances[featureId]!.granted ?? null)
              : null;
          const used = await resolveUsageValue({
            owner: resolved.owner,
            key: body.key,
            tools: resolved.tools,
            billing,
            customer: resolved.customer,
          });
          const limit = resolveEffectiveLimit(plan.limits?.[body.key] ?? null, granted);
          const remaining =
            typeof used === "number" && typeof limit === "number"
              ? Math.max(limit - used, 0)
              : null;

          return Response.json({
            planId,
            key: body.key,
            used,
            limit,
            remaining,
          } satisfies AutumnBillingUsageResult);
        },
      }),
      integrationRoute.post(meterUsagePath, {
        responseFormat: "json",
        async handler(request, ctx) {
          const body = (await request.json().catch(() => ({}))) as AutumnBillingMeterUsageInput;
          if (!body.key) {
            return new Response("An Autumn meter key is required.", { status: 400 });
          }

          const meter = billing.meters?.[body.key];
          if (!meter) {
            return new Response(`Unknown Autumn meter "${body.key}".`, { status: 404 });
          }
          const featureId = resolveMeterFeatureId(meter);
          if (!featureId) {
            return new Response(`Autumn meter "${body.key}" is missing a featureId.`, {
              status: 500,
            });
          }

          const resolved = await requireOwner(ctx, billing, sdk);
          const active = resolveActiveProduct(resolved.customer, products);
          const planId = active.product?.planId ?? "free";
          const plan = plans[planId] ?? {};
          const balance = resolved.customer.balances?.[featureId] ?? null;
          const livePlan = active.product?.autumnPlanId
            ? await sdk.plans.get({ planId: active.product.autumnPlanId })
            : null;
          const currentUsed = getProjectedUsage({
            externalCustomerId: resolved.externalCustomerId,
            featureId,
            currentPeriodEnd: currentPeriodEnd(active.subscription),
            currentPeriodUsed: balance?.usage ?? 0,
          });
          const estimate = estimateUsageChargeFromBalance({
            balance,
            livePlan,
            featureId,
          });
          const baseSubscriptionAmount = toCentsFromDollars(livePlan?.price?.amount ?? null);
          const includedLimit = plan.limits?.[body.key] ?? balance?.granted ?? null;
          const softLimit = resolveSoftLimit(plans, planId, body.key, includedLimit, meter.guard);
          const hardLimit = resolveHardLimit(planId, includedLimit, meter.guard);
          const state = computeMeterState({
            currentUsed,
            subscriptionStatus: active.status,
            includedLimit,
            softLimit,
            hardLimit,
            guard: meter.guard,
            featureFound: balance != null,
          });

          return Response.json({
            planId,
            productId: active.product?.id ?? null,
            key: body.key,
            eventName: meter.eventName ?? featureId,
            meterId: featureId,
            meterName:
              livePlan?.items.find((item) => item.featureId === featureId)?.feature?.name ??
              featureId,
            unit:
              meter.unit ??
              livePlan?.items.find((item) => item.featureId === featureId)?.feature?.display
                ?.plural ??
              null,
            aggregation: meter.aggregation,
            quantityMetadataKey: null,
            activeMeterIds: balance ? [featureId] : [],
            customerId: resolved.customer.id,
            subscriptionId: active.subscription?.id ?? null,
            subscriptionStatus: active.status,
            currentPeriodStart: currentPeriodStart(active.subscription),
            currentPeriodEnd: currentPeriodEnd(active.subscription),
            currentPeriodUsed: currentUsed,
            creditedUnits: balance?.granted ?? null,
            balance: balance?.remaining ?? null,
            currency: active.product?.currency ?? "usd",
            baseSubscriptionAmount,
            meterUnitAmount: estimate.unitAmountDecimal,
            meterCapAmount: estimate.capAmount,
            billingUnits: estimate.billingUnits,
            chargeSource: estimate.chargeSource,
            estimatedMeterChargeAmount: estimate.estimatedMeterChargeAmount,
            estimatedCombinedAmount:
              baseSubscriptionAmount != null && estimate.estimatedMeterChargeAmount != null
                ? baseSubscriptionAmount + estimate.estimatedMeterChargeAmount
                : baseSubscriptionAmount,
            includedLimit,
            softLimit,
            hardLimit,
            remainingIncluded:
              typeof includedLimit === "number" ? Math.max(includedLimit - currentUsed, 0) : null,
            remainingHard:
              typeof hardLimit === "number" ? Math.max(hardLimit - currentUsed, 0) : null,
            state: state.state,
            warning: state.warning,
          } satisfies AutumnBillingMeterUsageResult);
        },
      }),
      integrationRoute.post(reportUsagePath, {
        responseFormat: "json",
        async handler(request, ctx) {
          const body = (await request.json().catch(() => ({}))) as AutumnBillingReportUsageInput;
          if (!body.key) {
            return new Response("An Autumn meter key is required.", { status: 400 });
          }
          if (typeof body.quantity !== "number" || !Number.isFinite(body.quantity)) {
            return new Response("A numeric quantity is required.", { status: 400 });
          }

          const meter = billing.meters?.[body.key];
          if (!meter) {
            return new Response(`Unknown Autumn meter "${body.key}".`, { status: 404 });
          }
          const featureId = resolveMeterFeatureId(meter);
          if (!featureId) {
            return new Response(`Autumn meter "${body.key}" is missing a featureId.`, {
              status: 500,
            });
          }

          const resolved = await requireOwner(ctx, billing, sdk);
          const active = resolveActiveProduct(resolved.customer, products);
          const planId = active.product?.planId ?? "free";
          const plan = plans[planId] ?? {};
          const livePlan = active.product?.autumnPlanId
            ? await sdk.plans.get({ planId: active.product.autumnPlanId })
            : null;
          const currentUsed = getProjectedUsage({
            externalCustomerId: resolved.externalCustomerId,
            featureId,
            currentPeriodEnd: currentPeriodEnd(active.subscription),
            currentPeriodUsed: resolved.customer.balances?.[featureId]?.usage ?? 0,
          });
          const includedLimit =
            plan.limits?.[body.key] ?? resolved.customer.balances?.[featureId]?.granted ?? null;
          const softLimit = resolveSoftLimit(plans, planId, body.key, includedLimit, meter.guard);
          const hardLimit = resolveHardLimit(planId, includedLimit, meter.guard);
          const projectedCurrentPeriodUsed = projectMeterUsage({
            aggregation: meter.aggregation,
            currentUsed,
            quantity: body.quantity,
          });

          if (typeof hardLimit === "number" && projectedCurrentPeriodUsed > hardLimit) {
            return Response.json({
              key: body.key,
              quantity: body.quantity,
              customerId: resolved.customer.id,
              eventName: meter.eventName ?? featureId,
              eventIdentifier: body.idempotencyKey,
              occurredAt: body.occurredAt ?? new Date().toISOString(),
              currentPeriodUsed: currentUsed,
              projectedCurrentPeriodUsed,
              softLimit,
              hardLimit,
              state: "hard_limit_reached",
              warning:
                "The configured metered hard cap has been reached for the current billing period. Reported usage is blocked until the next cycle or a plan change.",
            } satisfies AutumnBillingReportUsageResult);
          }

          if (isPrepaidFeatureQuantity({ livePlan, product: active.product, featureId })) {
            if (!active.product?.autumnPlanId) {
              return new Response(
                "Autumn prepaid quantity updates require an active subscription product.",
                { status: 409 },
              );
            }

            const customizedItems = mergeAutumnProductItems(livePlan, active.product);
            await sdk.billing.update({
              customerId: resolved.customer.id ?? resolved.externalCustomerId,
              planId: active.product.autumnPlanId,
              featureQuantities: [
                {
                  featureId,
                  quantity: body.quantity,
                },
              ],
              customize:
                customizedItems.length > 0
                  ? {
                      items: customizedItems as AutumnUpdateCustomizeItems,
                    }
                  : undefined,
              prorationBehavior: "prorate_immediately",
              redirectMode: "never",
            });
          } else {
            // Autumn's current SDK/runtime track path is inconsistent across the published
            // types/docs and the actual endpoint behavior. Update the balance usage directly so
            // the example remains functional and type-safe for metered demos.
            await sdk.balances.update({
              customerId: resolved.customer.id ?? resolved.externalCustomerId,
              featureId,
              usage: projectedCurrentPeriodUsed,
            });
          }
          const nextUsed = projectedCurrentPeriodUsed;

          setProjectedUsage({
            externalCustomerId: resolved.externalCustomerId,
            featureId,
            currentPeriodEnd: currentPeriodEnd(active.subscription),
            projectedUsage: nextUsed,
          });

          await billing.hooks?.onUsageReported?.(
            {
              owner: resolved.owner,
              key: body.key,
              quantity: body.quantity,
              idempotencyKey: body.idempotencyKey,
              occurredAt: body.occurredAt ?? new Date().toISOString(),
              eventName: meter.eventName ?? featureId,
              customerId: resolved.customer.id,
              projectedCurrentPeriodUsed: nextUsed,
            },
            resolved.tools,
          );

          return Response.json({
            key: body.key,
            quantity: body.quantity,
            customerId: resolved.customer.id,
            eventName: meter.eventName ?? featureId,
            eventIdentifier: body.idempotencyKey,
            occurredAt: body.occurredAt ?? new Date().toISOString(),
            currentPeriodUsed: currentUsed,
            projectedCurrentPeriodUsed: nextUsed,
            softLimit,
            hardLimit,
            state:
              typeof hardLimit === "number" && nextUsed >= hardLimit
                ? "hard_limit_reached"
                : typeof softLimit === "number" && nextUsed >= softLimit
                  ? "soft_limit_reached"
                  : "ok",
            warning:
              typeof hardLimit === "number" && nextUsed >= hardLimit
                ? "The configured metered hard cap has been reached for the current billing period."
                : typeof softLimit === "number" && nextUsed >= softLimit
                  ? "Included usage has been exhausted. Additional usage is billable."
                  : null,
          } satisfies AutumnBillingReportUsageResult);
        },
      }),
      integrationRoute.post(checkPath, {
        responseFormat: "json",
        async handler(request, ctx) {
          const body = (await request.json().catch(() => ({}))) as AutumnBillingCheckInput;
          if (!body.key) {
            return new Response("An Autumn meter key is required.", { status: 400 });
          }

          const meter = billing.meters?.[body.key];
          if (!meter) {
            return new Response(`Unknown Autumn meter "${body.key}".`, { status: 404 });
          }
          const featureId = resolveMeterFeatureId(meter);
          if (!featureId) {
            return new Response(`Autumn meter "${body.key}" is missing a featureId.`, {
              status: 500,
            });
          }

          const amount =
            typeof body.amount === "number" && Number.isFinite(body.amount) && body.amount > 0
              ? body.amount
              : 1;
          const resolved = await requireOwner(ctx, billing, sdk);
          const active = resolveActiveProduct(resolved.customer, products);
          const planId = active.product?.planId ?? "free";
          const plan = plans[planId] ?? {};
          const checked = (await sdk.check({
            customerId: resolved.customer.id ?? resolved.externalCustomerId,
            featureId,
            requiredBalance: amount,
          })) as CheckResponse;
          const used = checked.balance?.usage ?? null;
          const limit = resolveEffectiveLimit(
            plan.limits?.[body.key] ?? null,
            checked.balance?.granted ?? null,
          );
          const remaining = checked.balance?.remaining ?? null;

          return Response.json({
            planId,
            key: body.key,
            amount,
            used,
            limit,
            remaining,
            allowed: checked.allowed,
          } satisfies AutumnBillingCheckResult);
        },
      }),
      integrationRoute.post(checkoutPath, {
        responseFormat: "json",
        async handler(request, ctx) {
          const body = (await request.json().catch(() => ({}))) as AutumnCheckoutInput;
          if (!body.productId) {
            return new Response("A billing productId is required.", { status: 400 });
          }

          const product = products.find((entry) => entry.id === body.productId);
          if (!product) {
            return new Response(`Unknown Autumn billing product "${body.productId}".`, {
              status: 404,
            });
          }

          const resolved = await requireOwner(ctx, billing, sdk);
          const successPath = resolveAppPath(body.successPath, "Autumn checkout successPath");
          const successUrl = successPath
            ? toAbsoluteUrl(successPath, ctx.request, appBaseUrl).toString()
            : undefined;
          const livePlan = await sdk.plans.get({ planId: product.autumnPlanId });
          const customizedItems = mergeAutumnProductItems(livePlan, product);
          const attached = (await sdk.billing.attach({
            customerId: resolved.customer.id ?? resolved.externalCustomerId,
            planId: product.autumnPlanId,
            redirectMode: "always",
            successUrl,
            metadata: body.metadata,
            customize:
              customizedItems.length > 0
                ? {
                    items: customizedItems as AutumnAttachCustomizeItems,
                  }
                : undefined,
            featureQuantities: Object.entries(product.autumn?.featureQuantities ?? {}).map(
              ([featureId, quantity]) => ({
                featureId,
                quantity,
              }),
            ),
          })) as AttachResponse;

          return Response.json({
            productId: product.id,
            planId: product.planId ?? null,
            customerId: attached.customerId,
            redirectTo: attached.paymentUrl ?? successUrl ?? appBaseUrl ?? "/",
            requiredActionCode: attached.requiredAction?.code ?? null,
          } satisfies AutumnCheckoutResult);
        },
      }),
      integrationRoute.post(portalPath, {
        responseFormat: "json",
        async handler(request, ctx) {
          const body = (await request.json().catch(() => ({}))) as AutumnPortalInput;
          const resolved = await requireOwner(ctx, billing, sdk);
          const returnPath = resolveAppPath(body.returnTo, "Autumn portal returnTo");
          const returnUrl = returnPath
            ? toAbsoluteUrl(returnPath, ctx.request, appBaseUrl).toString()
            : appBaseUrl;
          const portal = await sdk.billing.openCustomerPortal({
            customerId: resolved.customer.id ?? resolved.externalCustomerId,
            returnUrl,
          });

          return Response.json({
            customerId: portal.customerId,
            redirectTo: portal.url,
          } satisfies AutumnPortalResult);
        },
      }),
      ...webhookRoutes,
    ],
  });
}
