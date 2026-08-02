import { Polar } from "@polar-sh/sdk";
import type { CustomerState } from "@polar-sh/sdk/models/components/customerstate";
import type { CustomerStateMeter } from "@polar-sh/sdk/models/components/customerstatemeter";
import type { CustomerStateSubscription } from "@polar-sh/sdk/models/components/customerstatesubscription";
import { ResourceNotFound } from "@polar-sh/sdk/models/errors/resourcenotfound";
import {
  validateEvent as validatePolarWebhookEvent,
  WebhookVerificationError as PolarWebhookVerificationError,
} from "@polar-sh/sdk/webhooks";
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
  createPolarClientApi,
  polarClient,
  type PolarBillingCurrentChargeLine,
  type PolarBillingCurrentChargesResult,
  type PolarBillingCheckInput,
  type PolarBillingCheckResult,
  type PolarBillingFeaturesResult,
  type PolarBillingLimitsResult,
  type PolarBillingMeterState,
  type PolarBillingMeterUsageInput,
  type PolarBillingMeterUsageResult,
  type PolarBillingProductKind,
  type PolarBillingReportUsageInput,
  type PolarBillingReportUsageResult,
  type PolarBillingStatus,
  type PolarBillingStatusResult,
  type PolarBillingUsageInput,
  type PolarBillingUsageProperties,
  type PolarBillingUsageResult,
  type PolarCatalogMeterPrice,
  type PolarCatalogProduct,
  type PolarClientAPI,
  type PolarDefaultClientAPI,
  type PolarCheckoutInput,
  type PolarCheckoutResult,
  type PolarPortalInput,
  type PolarPortalResult,
} from "./client.js";

export type {
  PolarBillingCurrentChargeLine,
  PolarBillingCurrentChargesResult,
  PolarBillingCheckInput,
  PolarBillingCheckResult,
  PolarBillingFeaturesResult,
  PolarBillingLimitsResult,
  PolarBillingMeterState,
  PolarBillingMeterUsageInput,
  PolarBillingMeterUsageResult,
  PolarBillingReportUsageInput,
  PolarBillingReportUsageResult,
  PolarBillingStatusResult,
  PolarBillingUsageInput,
  PolarClientAPI,
  PolarDefaultClientAPI,
  PolarBillingUsageProperties,
  PolarBillingUsageResult,
  PolarCatalogMeterPrice,
  PolarCatalogProduct,
  PolarCheckoutInput,
  PolarCheckoutResult,
  PolarPortalInput,
  PolarPortalResult,
} from "./client.js";
export { polarClient } from "./client.js";

type PolarValidatedWebhookPayload = ReturnType<typeof validatePolarWebhookEvent>;

export interface PolarWebhookEvent extends FarmWebhookEvent<
  "polar",
  PolarValidatedWebhookPayload["type"],
  PolarValidatedWebhookPayload["data"],
  PolarValidatedWebhookPayload
> {}

export type PolarWebhookConfig = FarmWebhookConfig<PolarWebhookEvent>;

export type PolarBillingOwner = {
  kind: "user" | "organization";
  id: string;
  email?: string;
};

export type PolarBillingFeatures = Record<string, boolean>;
export type PolarBillingLimits = Record<string, number>;
export type PolarBillingEntitlements = Record<string, unknown>;
export type PolarBillingMeterAggregation = "sum" | "count" | "last";
export type PolarBillingMeterIngestion = "raw" | "pre_aggregated";
export interface PolarBillingPlanLimitReference {
  planId: string;
  key?: string;
}
export type PolarBillingSoftLimit =
  | "plan_limit"
  | number
  | PolarBillingPlanLimitReference
  | `plans.${string}.limit.${string}`
  | `plans.${string}.limits.${string}`;

export interface PolarBillingPlan {
  public?: boolean;
  features?: PolarBillingFeatures;
  limits?: PolarBillingLimits;
  entitlements?: PolarBillingEntitlements;
  trial?: {
    days: number;
    oncePerOwner?: boolean;
  };
}

export interface PolarBillingMeterGuard {
  softLimit?: PolarBillingSoftLimit;
  hardLimit?: number;
  hardOverage?: number;
  hardLimitByPlan?: Record<string, number>;
  hardOverageByPlan?: Record<string, number>;
  blockOnPastDue?: boolean;
}

export interface PolarBillingMeterProviderOptions {
  meterId: string;
  quantityMetadataKey?: string;
}

export interface PolarBillingProductStripeOptions {
  priceId?: string;
  seatPriceId?: string;
  meterPriceIds?: Record<string, string>;
  lookupKey?: string;
}

export interface PolarBillingProductPolarOptions {
  productId?: string;
}

export interface PolarBillingMeter {
  aggregation: PolarBillingMeterAggregation;
  ingestion?: PolarBillingMeterIngestion;
  window?: "hour" | "day";
  eventName: string;
  unit?: string;
  guard?: PolarBillingMeterGuard;
  polar?: PolarBillingMeterProviderOptions;
  meterId?: string;
  quantityMetadataKey?: string;
}

export interface PolarBillingProduct {
  public?: boolean;
  name?: string;
  description?: string;
  kind: PolarBillingProductKind;
  planId?: string;
  stripe?: PolarBillingProductStripeOptions;
  polar?: PolarBillingProductPolarOptions;
  productId?: string;
  currency?: string;
  unitAmount?: number;
  interval?: "day" | "week" | "month" | "year";
  intervalCount?: number;
  metadata?: Record<string, string>;
}

export interface PolarBillingHookTools {
  ctx: FarmIntegrationHandlerContext;
  polar: Polar;
}

export interface PolarBillingUsageOptions {
  resolve(
    owner: PolarBillingOwner,
    key: string,
    tools: PolarBillingHookTools,
  ): Promise<number | null> | number | null;
}

export interface PolarBillingHooks {
  onUsageReported?(
    payload: {
      owner: PolarBillingOwner;
      key: string;
      quantity: number;
      idempotencyKey: string;
      occurredAt: string;
      eventName: string;
      customerId: string | null;
      projectedCurrentPeriodUsed: number | null;
    },
    tools: PolarBillingHookTools,
  ): Promise<void> | void;
}

export interface PolarBillingOptions {
  resolveOwner(
    context: FarmIntegrationHandlerContext,
  ): Promise<PolarBillingOwner | null> | PolarBillingOwner | null;
  resolveExternalCustomerId?(
    owner: PolarBillingOwner,
    tools: PolarBillingHookTools,
  ): Promise<string> | string;
  plans?: Record<string, PolarBillingPlan>;
  products?: Record<string, PolarBillingProduct>;
  usage?: PolarBillingUsageOptions;
  meters?: Record<string, PolarBillingMeter>;
  hooks?: PolarBillingHooks;
}

export interface PolarIntegrationInput {
  /** Existing Polar SDK instance. When provided, Farm does not construct its own client. */
  instance?: PolarIntegrationInstance;
  accessToken?: string;
  server?: "sandbox" | "production";
  appBaseUrl?: string;
  webhooks?: PolarWebhookConfig;
  productsPath?: string;
  statusPath?: string;
  currentChargesPath?: string;
  featuresPath?: string;
  limitsPath?: string;
  usagePath?: string;
  meterUsagePath?: string;
  reportUsagePath?: string;
  checkPath?: string;
  checkoutPath?: string;
  portalPath?: string;
  billing: PolarBillingOptions;
  log?: FarmIntegrationLogger;
}

export type PolarIntegrationInstance = Polar;

interface ResolvedPolarConfig {
  accessToken?: string;
  server: "sandbox" | "production";
  appBaseUrl?: string;
  webhookSecret?: string;
}

interface ResolvedPolarProduct extends PolarBillingProduct {
  id: string;
  public: boolean;
  productId: string;
}

const pendingPolarMeterProjection = new Map<string, number>();

type PolarMeteredUnitPrice = {
  amountType: "metered_unit";
  unitAmount?: string | null;
  capAmount?: number | null;
  meterId?: string | null;
};

type PolarFixedPrice = {
  amountType: "fixed";
  priceAmount?: number | null;
};

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

type ResolvedPolarIntegrationPath<
  TPath extends string | undefined,
  TDefault extends string,
> = TPath extends string ? TPath : TDefault;

type PolarResolvedApiInput<TInput extends PolarIntegrationInput> = {
  readonly productsPath: ResolvedPolarIntegrationPath<TInput["productsPath"], "/billing/products">;
  readonly statusPath: ResolvedPolarIntegrationPath<TInput["statusPath"], "/billing/status">;
  readonly currentChargesPath: ResolvedPolarIntegrationPath<
    TInput["currentChargesPath"],
    "/billing/current-charges"
  >;
  readonly featuresPath: ResolvedPolarIntegrationPath<TInput["featuresPath"], "/billing/features">;
  readonly limitsPath: ResolvedPolarIntegrationPath<TInput["limitsPath"], "/billing/limits">;
  readonly usagePath: ResolvedPolarIntegrationPath<TInput["usagePath"], "/billing/usage">;
  readonly meterUsagePath: ResolvedPolarIntegrationPath<
    TInput["meterUsagePath"],
    "/billing/meter-usage"
  >;
  readonly reportUsagePath: ResolvedPolarIntegrationPath<
    TInput["reportUsagePath"],
    "/billing/report-usage"
  >;
  readonly checkPath: ResolvedPolarIntegrationPath<TInput["checkPath"], "/billing/check">;
  readonly checkoutPath: ResolvedPolarIntegrationPath<TInput["checkoutPath"], "/billing/checkout">;
  readonly portalPath: ResolvedPolarIntegrationPath<TInput["portalPath"], "/billing/portal">;
};

type PolarDefaultPathInput = {
  productsPath?: undefined;
  statusPath?: undefined;
  currentChargesPath?: undefined;
  featuresPath?: undefined;
  limitsPath?: undefined;
  usagePath?: undefined;
  meterUsagePath?: undefined;
  reportUsagePath?: undefined;
  checkPath?: undefined;
  checkoutPath?: undefined;
  portalPath?: undefined;
};

type PolarIntegrationResult<TApi> = Omit<FarmIntegration, "api"> & {
  api: TApi;
};

function createPolarApi<
  const TInput extends {
    productsPath: string;
    statusPath: string;
    currentChargesPath: string;
    featuresPath: string;
    limitsPath: string;
    usagePath: string;
    meterUsagePath: string;
    reportUsagePath: string;
    checkPath: string;
    checkoutPath: string;
    portalPath: string;
  },
>(input: TInput): PolarClientAPI<TInput> {
  return createPolarClientApi(input);
}

function normalizeStatus(value: string | null | undefined): PolarBillingStatus {
  switch (value) {
    case "trialing":
    case "active":
    case "past_due":
    case "canceled":
    case "unpaid":
    case "incomplete":
      return value;
    default:
      return "free";
  }
}

function normalizeProducts(products: PolarBillingOptions["products"]): ResolvedPolarProduct[] {
  return Object.entries(products ?? {}).map(([id, product]) => {
    const productId = product.polar?.productId ?? product.productId;
    if (!productId) {
      throw new Error(`Polar billing product "${id}" requires a productId.`);
    }

    return {
      ...product,
      productId,
      id,
      public: product.public ?? true,
    };
  });
}

function toCatalogProduct(
  product: ResolvedPolarProduct,
  plans: Record<string, PolarBillingPlan>,
): PolarCatalogProduct {
  return {
    id: product.id,
    productId: product.productId,
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

function resolvePolarTrialDays(input: {
  trialInterval: string | null | undefined;
  trialIntervalCount: number | null | undefined;
}): number | null {
  const count =
    typeof input.trialIntervalCount === "number" && input.trialIntervalCount > 0
      ? input.trialIntervalCount
      : null;

  if (!count) {
    return null;
  }

  switch (input.trialInterval) {
    case "day":
      return count;
    case "week":
      return count * 7;
    default:
      return null;
  }
}

function formatPolarCatalogMoney(amount: number, currency: string | null): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
    maximumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100);
}

function formatPolarCatalogUnitAmount(value: string, currency: string | null): string {
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

function summarizePolarCatalogMeterPrice(input: {
  unitAmountDecimal: string | null;
  unit: string | null;
  capAmount: number | null;
  currency: string | null;
}): string | null {
  if (!input.unitAmountDecimal) {
    return null;
  }

  const rate = `${formatPolarCatalogUnitAmount(
    input.unitAmountDecimal,
    input.currency,
  )}/${input.unit ?? "unit"}`;

  if (typeof input.capAmount === "number") {
    return `${rate}, capped at ${formatPolarCatalogMoney(input.capAmount, input.currency)}`;
  }

  return rate;
}

async function enrichCatalogProduct(
  sdk: Polar,
  product: ResolvedPolarProduct,
  plans: Record<string, PolarBillingPlan>,
  meters: PolarBillingOptions["meters"],
): Promise<PolarCatalogProduct> {
  const base = toCatalogProduct(product, plans);

  try {
    const liveProduct = await sdk.products.get({
      id: product.productId,
    });
    const byMeterId = new Map<string, { key: string; meter: PolarBillingMeter }>();

    for (const [key, meter] of Object.entries(meters ?? {})) {
      const meterId = resolvePolarMeterId(meter);
      if (meterId) {
        byMeterId.set(meterId, { key, meter });
      }
    }

    const fixedPrice = (liveProduct.prices?.find(
      (price) =>
        isPolarFixedPrice(price) && typeof (price as PolarFixedPrice).priceAmount === "number",
    ) ?? null) as PolarFixedPrice | null;

    const meterPrices: PolarCatalogMeterPrice[] = [];
    for (const price of liveProduct.prices ?? []) {
      if (!isPolarMeteredUnitPrice(price)) {
        continue;
      }

      const meteredPrice = price as PolarMeteredUnitPrice;
      const match = meteredPrice.meterId ? byMeterId.get(meteredPrice.meterId) : null;
      if (!match || !meteredPrice.meterId) {
        continue;
      }

      meterPrices.push({
        key: match.key,
        eventName: match.meter.eventName,
        meterId: meteredPrice.meterId,
        unit: match.meter.unit ?? null,
        currency: product.currency ?? null,
        unitAmountDecimal: meteredPrice.unitAmount ?? null,
        capAmount: typeof meteredPrice.capAmount === "number" ? meteredPrice.capAmount : null,
        summary: summarizePolarCatalogMeterPrice({
          unitAmountDecimal: meteredPrice.unitAmount ?? null,
          unit: match.meter.unit ?? null,
          capAmount: typeof meteredPrice.capAmount === "number" ? meteredPrice.capAmount : null,
          currency: product.currency ?? null,
        }),
      });
    }

    return {
      ...base,
      trialDays:
        resolvePolarTrialDays({
          trialInterval: liveProduct.trialInterval,
          trialIntervalCount: liveProduct.trialIntervalCount,
        }) ?? base.trialDays,
      unitAmount:
        typeof fixedPrice?.priceAmount === "number" ? fixedPrice.priceAmount : base.unitAmount,
      meterPrices,
    };
  } catch (error) {
    console.warn("Could not load live Polar product pricing for catalog.", {
      error,
      productId: product.productId,
    });
    return base;
  }
}

function getOwnerExternalCustomerId(
  owner: PolarBillingOwner,
  billing: PolarBillingOptions,
  tools: PolarBillingHookTools,
): Promise<string> | string {
  if (billing.resolveExternalCustomerId) {
    return billing.resolveExternalCustomerId(owner, tools);
  }

  return `${owner.kind}:${owner.id}`;
}

async function getCustomerStateByExternalId(
  polar: Polar,
  externalId: string,
): Promise<CustomerState | null> {
  try {
    return await polar.customers.getStateExternal({
      externalId,
    });
  } catch (error) {
    if (error instanceof ResourceNotFound) {
      return null;
    }
    throw error;
  }
}

function resolveActiveProduct(
  state: CustomerState | null,
  products: readonly ResolvedPolarProduct[],
): {
  product: ResolvedPolarProduct | null;
  subscriptionId: string | null;
  status: PolarBillingStatus;
} {
  const byProductId = new Map<string, ResolvedPolarProduct>(
    products.map((product) => [product.productId, product]),
  );
  const matched = [...(state?.activeSubscriptions ?? [])]
    .filter((subscription: CustomerStateSubscription) => byProductId.has(subscription.productId))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];

  if (!matched) {
    return {
      product: null,
      subscriptionId: null,
      status: "free",
    };
  }

  return {
    product: byProductId.get(matched.productId) ?? null,
    subscriptionId: matched.id,
    status: normalizeStatus(matched.status),
  };
}

function findStateMeter(state: CustomerState | null, meterId: string): CustomerStateMeter | null {
  return state?.activeMeters.find((meter) => meter.meterId === meterId) ?? null;
}

function resolvePolarPlanLimitReference(
  value: PolarBillingSoftLimit | undefined,
  defaultKey: string,
): PolarBillingPlanLimitReference | null {
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
  plans: Record<string, PolarBillingPlan>,
  planId: string,
  key: string,
  includedLimit: number | null,
  guard: PolarBillingMeterGuard | undefined,
): number | null {
  if (!guard?.softLimit) {
    return null;
  }

  if (guard.softLimit === "plan_limit") {
    return includedLimit;
  }

  const reference = resolvePolarPlanLimitReference(guard.softLimit, key);
  if (reference) {
    const referencedLimit = plans[reference.planId]?.limits?.[reference.key ?? key] ?? null;
    return typeof referencedLimit === "number" ? referencedLimit : null;
  }

  return typeof guard.softLimit === "number" ? guard.softLimit : null;
}

function resolveHardLimit(
  planId: string,
  includedLimit: number | null,
  guard: PolarBillingMeterGuard | undefined,
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

function getMeterIncrement(
  aggregation: PolarBillingMeter["aggregation"],
  quantity: number,
): number {
  switch (aggregation) {
    case "count":
      return 1;
    case "last":
      return quantity;
    default:
      return quantity;
  }
}

function resolvePolarMeterId(meter: PolarBillingMeter): string | null {
  if (meter.polar?.meterId && meter.polar.meterId.trim()) {
    return meter.polar.meterId;
  }

  if (meter.meterId && meter.meterId.trim()) {
    return meter.meterId;
  }

  return null;
}

function resolvePolarQuantityMetadataKey(meter: PolarBillingMeter): string {
  if (meter.polar?.quantityMetadataKey && meter.polar.quantityMetadataKey.trim()) {
    return meter.polar.quantityMetadataKey;
  }

  if (meter.quantityMetadataKey && meter.quantityMetadataKey.trim()) {
    return meter.quantityMetadataKey;
  }

  return "quantity";
}

function toEstimatedMeterChargeAmount(input: {
  currentUsed: number;
  unitAmount: string | null | undefined;
  capAmount: number | null | undefined;
}): number | null {
  const parsedUnitAmount = Number(input.unitAmount ?? Number.NaN);
  if (!Number.isFinite(parsedUnitAmount)) {
    return null;
  }

  const uncappedAmount = Math.round(input.currentUsed * parsedUnitAmount * 100);
  if (typeof input.capAmount === "number") {
    return Math.min(uncappedAmount, input.capAmount);
  }

  return uncappedAmount;
}

function isPolarMeteredUnitPrice(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { amountType?: string }).amountType === "metered_unit"
  );
}

function isPolarFixedPrice(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { amountType?: string }).amountType === "fixed"
  );
}

function projectionKey(input: {
  externalCustomerId: string;
  meterId: string;
  currentPeriodEnd: string | null;
}): string {
  return `${input.externalCustomerId}:${input.meterId}:${input.currentPeriodEnd ?? "none"}`;
}

function getProjectedUsage(input: {
  externalCustomerId: string;
  meterId: string;
  currentPeriodEnd: string | null;
  currentPeriodUsed: number;
}): number {
  const key = projectionKey(input);
  const projected = pendingPolarMeterProjection.get(key);

  if (projected == null) {
    return input.currentPeriodUsed;
  }

  if (input.currentPeriodUsed >= projected) {
    pendingPolarMeterProjection.delete(key);
    return input.currentPeriodUsed;
  }

  return projected;
}

function setProjectedUsage(input: {
  externalCustomerId: string;
  meterId: string;
  currentPeriodEnd: string | null;
  projectedUsage: number;
}) {
  pendingPolarMeterProjection.set(projectionKey(input), input.projectedUsage);
}

async function resolveUsageValue(input: {
  owner: PolarBillingOwner;
  key: string;
  tools: PolarBillingHookTools;
  billing: PolarBillingOptions;
  state: CustomerState | null;
}): Promise<number | null> {
  const resolved = await input.billing.usage?.resolve?.(input.owner, input.key, input.tools);

  if (typeof resolved === "number") {
    return resolved;
  }

  const meter = input.billing.meters?.[input.key];
  if (!meter) {
    return null;
  }

  const meterId = resolvePolarMeterId(meter);
  if (!meterId) {
    return null;
  }

  return findStateMeter(input.state, meterId)?.consumedUnits ?? 0;
}

async function requireOwner(
  ctx: FarmIntegrationHandlerContext,
  billing: PolarBillingOptions,
  polar: Polar,
) {
  const tools: PolarBillingHookTools = { ctx, polar };
  const owner = await billing.resolveOwner(ctx);

  if (!owner) {
    throw new Error("Polar billing owner could not be resolved for this request.");
  }

  const externalCustomerId = await getOwnerExternalCustomerId(owner, billing, tools);
  const state = await getCustomerStateByExternalId(polar, externalCustomerId);

  return {
    owner,
    externalCustomerId,
    state,
    tools,
  };
}

function computeMeterState(input: {
  currentUsed: number;
  subscriptionStatus: PolarBillingStatus;
  includedLimit: number | null;
  softLimit: number | null;
  hardLimit: number | null;
  guard: PolarBillingMeterGuard | undefined;
  meterFound: boolean;
  customerFound: boolean;
}): {
  state: PolarBillingMeterState;
  warning: string | null;
} {
  if (!input.customerFound) {
    return {
      state: "customer_missing",
      warning: "No Polar customer exists for the active billing owner yet.",
    };
  }

  if (!input.meterFound) {
    return {
      state: "meter_missing",
      warning: "The configured Polar customer meter is not active for this customer.",
    };
  }

  if (
    input.guard?.blockOnPastDue &&
    (input.subscriptionStatus === "past_due" || input.subscriptionStatus === "unpaid")
  ) {
    return {
      state: "blocked_past_due",
      warning: "Usage reporting is blocked while the Polar subscription is past due.",
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

export function polar<const TInput extends PolarIntegrationInput & PolarDefaultPathInput>(
  input: TInput,
): PolarIntegrationResult<PolarDefaultClientAPI>;
export function polar<const TInput extends PolarIntegrationInput>(
  input: TInput,
): PolarIntegrationResult<PolarClientAPI<PolarResolvedApiInput<TInput>>>;
export function polar<TInput extends PolarIntegrationInput>(
  input: TInput,
): PolarIntegrationResult<FarmIntegrationAPI> {
  const accessToken = input.accessToken ?? process.env.POLAR_ACCESS_TOKEN ?? "";
  const server =
    input.server ?? (process.env.POLAR_SERVER as "sandbox" | "production" | undefined) ?? "sandbox";
  const appBaseUrl = input.appBaseUrl ?? process.env.APP_BASE_URL ?? undefined;
  const webhookSecret = process.env.POLAR_WEBHOOK_SECRET ?? undefined;

  if (!input.instance && !accessToken) {
    throw new Error("Polar integration requires a Polar instance or POLAR_ACCESS_TOKEN.");
  }

  const billing = input.billing;
  const productsPath = (input.productsPath ?? "/billing/products") as ResolvedPolarIntegrationPath<
    TInput["productsPath"],
    "/billing/products"
  >;
  const statusPath = (input.statusPath ?? "/billing/status") as ResolvedPolarIntegrationPath<
    TInput["statusPath"],
    "/billing/status"
  >;
  const currentChargesPath = (input.currentChargesPath ??
    "/billing/current-charges") as ResolvedPolarIntegrationPath<
    TInput["currentChargesPath"],
    "/billing/current-charges"
  >;
  const featuresPath = (input.featuresPath ?? "/billing/features") as ResolvedPolarIntegrationPath<
    TInput["featuresPath"],
    "/billing/features"
  >;
  const limitsPath = (input.limitsPath ?? "/billing/limits") as ResolvedPolarIntegrationPath<
    TInput["limitsPath"],
    "/billing/limits"
  >;
  const usagePath = (input.usagePath ?? "/billing/usage") as ResolvedPolarIntegrationPath<
    TInput["usagePath"],
    "/billing/usage"
  >;
  const meterUsagePath = (input.meterUsagePath ??
    "/billing/meter-usage") as ResolvedPolarIntegrationPath<
    TInput["meterUsagePath"],
    "/billing/meter-usage"
  >;
  const reportUsagePath = (input.reportUsagePath ??
    "/billing/report-usage") as ResolvedPolarIntegrationPath<
    TInput["reportUsagePath"],
    "/billing/report-usage"
  >;
  const checkPath = (input.checkPath ?? "/billing/check") as ResolvedPolarIntegrationPath<
    TInput["checkPath"],
    "/billing/check"
  >;
  const checkoutPath = (input.checkoutPath ?? "/billing/checkout") as ResolvedPolarIntegrationPath<
    TInput["checkoutPath"],
    "/billing/checkout"
  >;
  const portalPath = (input.portalPath ?? "/billing/portal") as ResolvedPolarIntegrationPath<
    TInput["portalPath"],
    "/billing/portal"
  >;
  const webhookDefinitions = normalizeWebhookConfig<PolarWebhookEvent>({
    webhooks: input.webhooks,
    defaultName: "default",
    defaultPath: "/billing/webhook",
    defaultSecret: webhookSecret,
  });
  const plans = billing.plans ?? {};
  const products = normalizeProducts(billing.products);
  for (const [key, meter] of Object.entries(billing.meters ?? {})) {
    if (!meter.eventName || !meter.eventName.trim()) {
      throw new Error(`Polar billing meter "${key}" requires a non-empty eventName.`);
    }

    if (!resolvePolarMeterId(meter)) {
      throw new Error(`Polar billing meter "${key}" requires polar.meterId (or legacy meterId).`);
    }
  }
  const sdk =
    input.instance ??
    new Polar({
      accessToken,
      server,
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
            throw new Error("Polar webhook secret is required to verify webhook events.");
          }

          const payload = validatePolarWebhookEvent(
            rawBody,
            headersToObject(request.headers),
            definition.secret,
          );
          const event: PolarWebhookEvent = {
            provider: "polar",
            id:
              request.headers.get("webhook-id") ??
              `${payload.type}:${payload.timestamp.toISOString()}`,
            type: payload.type,
            data: payload.data,
            raw: payload,
          };

          await definition.onEvent?.(event, webhookContext);

          return Response.json({
            received: true,
            provider: "polar",
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
              error: error instanceof Error ? error.message : "Polar webhook verification failed.",
            },
            {
              status: error instanceof PolarWebhookVerificationError ? 403 : 400,
            },
          );
        }
      },
    }),
  );

  return defineIntegration({
    category: "payment",
    type: "polar",
    instance: {
      server,
      products: products.map((product) => ({
        id: product.id,
        productId: product.productId,
        kind: product.kind,
        planId: product.planId ?? null,
      })),
    },
    config: integrationConfig<ResolvedPolarConfig>({
      label: "Polar integration",
      env: {
        accessToken: "POLAR_ACCESS_TOKEN",
        server: "POLAR_SERVER",
        appBaseUrl: "APP_BASE_URL",
        webhookSecret: "POLAR_WEBHOOK_SECRET",
      },
      input: {
        accessToken,
        server,
        appBaseUrl,
        webhookSecret,
      },
      required: input.instance ? ["server"] : ["accessToken", "server"],
    }),
    api: createPolarApi({
      productsPath,
      statusPath,
      currentChargesPath,
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
          return Response.json(
            await Promise.all(
              products
                .filter((product) => product.public)
                .map((product) => enrichCatalogProduct(sdk, product, plans, billing.meters)),
            ),
          );
        },
      }),
      integrationRoute.get(statusPath, {
        responseFormat: "json",
        async handler(_request, ctx) {
          const resolved = await requireOwner(ctx, billing, sdk);
          const active = resolveActiveProduct(resolved.state, products);
          const planId = active.product?.planId ?? "free";
          const plan = plans[planId] ?? {};
          const subscription =
            resolved.state?.activeSubscriptions.find(
              (entry: CustomerStateSubscription) => entry.id === active.subscriptionId,
            ) ?? null;

          return Response.json({
            owner: resolved.owner,
            externalCustomerId: resolved.externalCustomerId,
            customerId: resolved.state?.id ?? null,
            planId,
            productId: active.product?.id ?? null,
            status: active.status,
            subscriptionId: active.subscriptionId,
            currentPeriodStart: subscription?.currentPeriodStart?.toISOString() ?? null,
            currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
            cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
            trialEndsAt: subscription?.trialEnd?.toISOString() ?? null,
            features: plan.features ?? {},
            limits: plan.limits ?? {},
            entitlements: plan.entitlements ?? {},
          } satisfies PolarBillingStatusResult);
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
              subscriptionStatus: "free",
              currency: "usd",
              currentPeriodStart: null,
              currentPeriodEnd: null,
              baseSubscriptionAmount: null,
              pendingMeterChargeAmount: null,
              estimatedTotalAmount: null,
              lineItems: [],
            } satisfies PolarBillingCurrentChargesResult);
          }

          const resolved = await requireOwner(ctx, billing, sdk);
          const active = resolveActiveProduct(resolved.state, products);
          const planId = active.product?.planId ?? "free";
          const plan = plans[planId] ?? {};
          const subscription =
            resolved.state?.activeSubscriptions.find(
              (entry: CustomerStateSubscription) => entry.id === active.subscriptionId,
            ) ?? null;
          const currency = subscription?.currency ?? active.product?.currency ?? "usd";
          const baseSubscriptionAmount =
            typeof subscription?.amount === "number" ? subscription.amount : null;
          const lineItems: PolarBillingCurrentChargeLine[] = [];

          if (baseSubscriptionAmount != null) {
            lineItems.push({
              key: null,
              kind: "base_subscription",
              label: active.product?.name ?? "Base subscription",
              amount: baseSubscriptionAmount,
              currency,
              quantity: 1,
              includedUnits: null,
              overageUnits: null,
              billedBuckets: null,
              billingUnits: null,
              unitAmountDecimal: null,
            });
          }

          let liveProduct: Awaited<ReturnType<typeof sdk.products.get>> | null = null;
          if (active.product?.productId) {
            try {
              liveProduct = await sdk.products.get({
                id: active.product.productId,
              });
            } catch (error) {
              console.warn("Could not load live Polar product pricing for current charges.", {
                error,
                productId: active.product.productId,
              });
            }
          }

          let pendingMeterChargeAmount = 0;
          let sawMeterLine = false;

          for (const [key, meter] of Object.entries(billing.meters ?? {})) {
            const meterId = resolvePolarMeterId(meter);
            if (!meterId) {
              continue;
            }

            const subscriptionMeter =
              subscription?.meters.find((entry) => entry.meterId === meterId) ?? null;
            const customerMeter = findStateMeter(resolved.state, meterId);
            const currentPeriodEnd = subscription?.currentPeriodEnd?.toISOString() ?? null;
            const currentUsed = getProjectedUsage({
              externalCustomerId: resolved.externalCustomerId,
              meterId,
              currentPeriodEnd,
              currentPeriodUsed:
                subscriptionMeter?.consumedUnits ?? customerMeter?.consumedUnits ?? 0,
            });
            const liveMeteredPrice = (liveProduct?.prices?.find(
              (price) =>
                isPolarMeteredUnitPrice(price) &&
                (price as PolarMeteredUnitPrice).meterId === meterId,
            ) ?? null) as PolarMeteredUnitPrice | null;
            const unitAmountDecimal = liveMeteredPrice?.unitAmount ?? null;
            const capAmount =
              typeof liveMeteredPrice?.capAmount === "number" ? liveMeteredPrice.capAmount : null;
            const estimatedMeterChargeAmount =
              typeof subscriptionMeter?.amount === "number"
                ? subscriptionMeter.amount
                : toEstimatedMeterChargeAmount({
                    currentUsed,
                    unitAmount: unitAmountDecimal,
                    capAmount,
                  });

            const includedUnits =
              plan.limits?.[key] ??
              subscriptionMeter?.creditedUnits ??
              customerMeter?.creditedUnits ??
              null;
            const overageUnits =
              typeof includedUnits === "number" ? Math.max(currentUsed - includedUnits, 0) : null;

            if (
              currentUsed <= 0 &&
              estimatedMeterChargeAmount == null &&
              !subscriptionMeter &&
              !customerMeter &&
              !liveMeteredPrice
            ) {
              continue;
            }

            sawMeterLine = true;
            pendingMeterChargeAmount += estimatedMeterChargeAmount ?? 0;
            lineItems.push({
              key,
              kind: "metered_usage",
              label: `${meter.unit ?? key} overage`,
              amount: estimatedMeterChargeAmount,
              currency,
              quantity: currentUsed,
              includedUnits,
              overageUnits,
              billedBuckets: null,
              billingUnits: null,
              unitAmountDecimal,
            });
          }

          return Response.json({
            owner: resolved.owner,
            externalCustomerId: resolved.externalCustomerId,
            customerId: resolved.state?.id ?? null,
            planId,
            productId: active.product?.id ?? null,
            subscriptionId: active.subscriptionId,
            subscriptionStatus: active.status,
            currency,
            currentPeriodStart: subscription?.currentPeriodStart?.toISOString() ?? null,
            currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
            baseSubscriptionAmount,
            pendingMeterChargeAmount: sawMeterLine ? pendingMeterChargeAmount : null,
            estimatedTotalAmount:
              (baseSubscriptionAmount ?? 0) + (sawMeterLine ? pendingMeterChargeAmount : 0),
            lineItems,
          } satisfies PolarBillingCurrentChargesResult);
        },
      }),
      integrationRoute.get(featuresPath, {
        responseFormat: "json",
        async handler(_request, ctx) {
          const resolved = await requireOwner(ctx, billing, sdk);
          const active = resolveActiveProduct(resolved.state, products);
          const planId = active.product?.planId ?? "free";
          const plan = plans[planId] ?? {};

          return Response.json({
            planId,
            features: plan.features ?? {},
          } satisfies PolarBillingFeaturesResult);
        },
      }),
      integrationRoute.get(limitsPath, {
        responseFormat: "json",
        async handler(_request, ctx) {
          const resolved = await requireOwner(ctx, billing, sdk);
          const active = resolveActiveProduct(resolved.state, products);
          const planId = active.product?.planId ?? "free";
          const plan = plans[planId] ?? {};

          return Response.json({
            planId,
            limits: plan.limits ?? {},
          } satisfies PolarBillingLimitsResult);
        },
      }),
      integrationRoute.post(usagePath, {
        responseFormat: "json",
        async handler(request, ctx) {
          const body = (await request.json().catch(() => ({}))) as PolarBillingUsageInput;
          if (!body.key) {
            return new Response("A billing usage key is required.", { status: 400 });
          }

          const resolved = await requireOwner(ctx, billing, sdk);
          const active = resolveActiveProduct(resolved.state, products);
          const planId = active.product?.planId ?? "free";
          const plan = plans[planId] ?? {};
          const used = await resolveUsageValue({
            owner: resolved.owner,
            key: body.key,
            tools: resolved.tools,
            billing,
            state: resolved.state,
          });
          const limit = plan.limits?.[body.key] ?? null;
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
          } satisfies PolarBillingUsageResult);
        },
      }),
      integrationRoute.post(meterUsagePath, {
        responseFormat: "json",
        async handler(request, ctx) {
          const body = (await request.json().catch(() => ({}))) as PolarBillingMeterUsageInput;
          if (!body.key) {
            return new Response("A Polar meter key is required.", { status: 400 });
          }

          const meter = billing.meters?.[body.key];
          if (!meter) {
            return new Response(`Unknown Polar meter "${body.key}".`, { status: 404 });
          }
          const meterId = resolvePolarMeterId(meter);
          if (!meterId) {
            return new Response(`Polar meter "${body.key}" is missing a meterId.`, {
              status: 500,
            });
          }

          const resolved = await requireOwner(ctx, billing, sdk);
          const active = resolveActiveProduct(resolved.state, products);
          const planId = active.product?.planId ?? "free";
          const plan = plans[planId] ?? {};
          const subscription =
            resolved.state?.activeSubscriptions.find(
              (entry: CustomerStateSubscription) => entry.id === active.subscriptionId,
            ) ?? null;
          const subscriptionMeter =
            subscription?.meters.find((entry) => entry.meterId === meterId) ?? null;
          const customerMeter = findStateMeter(resolved.state, meterId);
          const currentUsed = getProjectedUsage({
            externalCustomerId: resolved.externalCustomerId,
            meterId,
            currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
            currentPeriodUsed:
              subscriptionMeter?.consumedUnits ?? customerMeter?.consumedUnits ?? 0,
          });
          let meterUnitAmount: string | null = null;
          let meterCapAmount: number | null = null;
          let estimatedMeterChargeAmount: number | null =
            typeof subscriptionMeter?.amount === "number" ? subscriptionMeter.amount : null;
          let chargeSource: "subscription_meter" | "catalog_rate" =
            estimatedMeterChargeAmount != null ? "subscription_meter" : "catalog_rate";
          let meterName: string | null = null;
          const baseSubscriptionAmount =
            typeof subscription?.amount === "number" ? subscription.amount : null;
          let currency = subscription?.currency ?? null;

          if (active.product?.productId) {
            try {
              const liveProduct = await sdk.products.get({
                id: active.product.productId,
              });
              const liveMeteredPrice = (liveProduct.prices?.find(
                (price) =>
                  isPolarMeteredUnitPrice(price) &&
                  (price as PolarMeteredUnitPrice).meterId === meterId,
              ) ?? null) as PolarMeteredUnitPrice | null;

              meterUnitAmount = liveMeteredPrice?.unitAmount ?? null;
              meterCapAmount =
                typeof liveMeteredPrice?.capAmount === "number" ? liveMeteredPrice.capAmount : null;
              meterName =
                (liveMeteredPrice as { meter?: { name?: string | null } | null })?.meter?.name ??
                null;
              if (estimatedMeterChargeAmount == null) {
                estimatedMeterChargeAmount = toEstimatedMeterChargeAmount({
                  currentUsed,
                  unitAmount: meterUnitAmount,
                  capAmount: meterCapAmount,
                });
                chargeSource = "catalog_rate";
              }
            } catch (error) {
              console.warn("Could not load live Polar metered pricing for meter usage.", {
                error,
                productId: active.product.productId,
                meterId,
              });
            }
          }

          const includedLimit = plan.limits?.[body.key] ?? null;
          const softLimit = resolveSoftLimit(plans, planId, body.key, includedLimit, meter.guard);
          const hardLimit = resolveHardLimit(planId, includedLimit, meter.guard);
          const state = computeMeterState({
            currentUsed,
            subscriptionStatus: active.status,
            includedLimit,
            softLimit,
            hardLimit,
            guard: meter.guard,
            meterFound: !!customerMeter,
            customerFound: !!resolved.state,
          });

          return Response.json({
            planId,
            productId: active.product?.id ?? null,
            key: body.key,
            eventName: meter.eventName,
            meterId,
            meterName,
            aggregation: meter.aggregation,
            quantityMetadataKey: resolvePolarQuantityMetadataKey(meter),
            activeMeterIds:
              resolved.state?.activeMeters?.map((entry: CustomerStateMeter) => entry.meterId) ?? [],
            customerId: resolved.state?.id ?? null,
            subscriptionId: active.subscriptionId,
            subscriptionStatus: active.status,
            currentPeriodStart: subscription?.currentPeriodStart?.toISOString() ?? null,
            currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
            currentPeriodUsed: currentUsed,
            creditedUnits: customerMeter?.creditedUnits ?? null,
            balance: customerMeter?.balance ?? null,
            currency,
            baseSubscriptionAmount,
            meterUnitAmount,
            meterCapAmount,
            chargeSource,
            estimatedMeterChargeAmount,
            estimatedCombinedAmount:
              typeof baseSubscriptionAmount === "number" &&
              typeof estimatedMeterChargeAmount === "number"
                ? baseSubscriptionAmount + estimatedMeterChargeAmount
                : null,
            includedLimit,
            softLimit,
            hardLimit,
            remainingIncluded:
              typeof includedLimit === "number" ? Math.max(includedLimit - currentUsed, 0) : null,
            remainingHard:
              typeof hardLimit === "number" ? Math.max(hardLimit - currentUsed, 0) : null,
            state: state.state,
            warning: state.warning,
          } satisfies PolarBillingMeterUsageResult);
        },
      }),
      integrationRoute.post(reportUsagePath, {
        responseFormat: "json",
        async handler(request, ctx) {
          const body = (await request.json().catch(() => ({}))) as PolarBillingReportUsageInput;
          if (!body.key) {
            return new Response("A Polar meter key is required.", { status: 400 });
          }
          if (!Number.isFinite(body.quantity) || body.quantity <= 0) {
            return new Response("Polar reported quantity must be a positive number.", {
              status: 400,
            });
          }
          if (!body.idempotencyKey) {
            return new Response("An idempotencyKey is required for Polar usage reporting.", {
              status: 400,
            });
          }

          const meter = billing.meters?.[body.key];
          if (!meter) {
            return new Response(`Unknown Polar meter "${body.key}".`, { status: 404 });
          }
          const meterId = resolvePolarMeterId(meter);
          if (!meterId) {
            return new Response(`Polar meter "${body.key}" is missing a meterId.`, {
              status: 500,
            });
          }

          const occurredAt =
            typeof body.occurredAt === "string" && body.occurredAt
              ? new Date(body.occurredAt)
              : new Date();
          if (Number.isNaN(occurredAt.getTime())) {
            return new Response("occurredAt must be a valid ISO timestamp.", { status: 400 });
          }

          const resolved = await requireOwner(ctx, billing, sdk);
          const active = resolveActiveProduct(resolved.state, products);
          const planId = active.product?.planId ?? "free";
          const plan = plans[planId] ?? {};
          const subscription =
            resolved.state?.activeSubscriptions.find(
              (entry: CustomerStateSubscription) => entry.id === active.subscriptionId,
            ) ?? null;
          const customerMeter = findStateMeter(resolved.state, meterId);
          const currentUsed = getProjectedUsage({
            externalCustomerId: resolved.externalCustomerId,
            meterId,
            currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
            currentPeriodUsed: customerMeter?.consumedUnits ?? 0,
          });
          const includedLimit = plan.limits?.[body.key] ?? null;
          const softLimit = resolveSoftLimit(plans, planId, body.key, includedLimit, meter.guard);
          const hardLimit = resolveHardLimit(planId, includedLimit, meter.guard);
          const state = computeMeterState({
            currentUsed,
            subscriptionStatus: active.status,
            includedLimit,
            softLimit,
            hardLimit,
            guard: meter.guard,
            meterFound: !!customerMeter,
            customerFound: !!resolved.state,
          });

          if (state.state === "blocked_past_due" || state.state === "hard_limit_reached") {
            return new Response(
              state.warning ?? "Polar usage reporting is blocked for the current billing period.",
              { status: 409 },
            );
          }

          const increment = getMeterIncrement(meter.aggregation, body.quantity);
          const projectedCurrentPeriodUsed = currentUsed + increment;
          if (typeof hardLimit === "number" && projectedCurrentPeriodUsed > hardLimit) {
            return new Response(
              "The configured metered hard cap has been reached for the current billing period. Reported usage is blocked until the next cycle or a plan change.",
              { status: 409 },
            );
          }

          const metadata: PolarBillingUsageProperties = {
            ...body.properties,
            [resolvePolarQuantityMetadataKey(meter)]: body.quantity,
          };

          await sdk.events.ingest({
            events: [
              {
                name: meter.eventName,
                externalCustomerId: resolved.externalCustomerId,
                externalId: body.idempotencyKey,
                timestamp: occurredAt,
                metadata,
              },
            ],
          });

          setProjectedUsage({
            externalCustomerId: resolved.externalCustomerId,
            meterId,
            currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
            projectedUsage: projectedCurrentPeriodUsed,
          });

          await billing.hooks?.onUsageReported?.(
            {
              owner: resolved.owner,
              key: body.key,
              quantity: body.quantity,
              idempotencyKey: body.idempotencyKey,
              occurredAt: occurredAt.toISOString(),
              eventName: meter.eventName,
              customerId: resolved.state?.id ?? null,
              projectedCurrentPeriodUsed,
            },
            resolved.tools,
          );

          const nextState =
            typeof hardLimit === "number" && projectedCurrentPeriodUsed >= hardLimit
              ? "hard_limit_reached"
              : typeof softLimit === "number" && projectedCurrentPeriodUsed >= softLimit
                ? "soft_limit_reached"
                : "ok";

          return Response.json({
            key: body.key,
            quantity: body.quantity,
            customerId: resolved.state?.id ?? null,
            eventName: meter.eventName,
            eventIdentifier: body.idempotencyKey,
            occurredAt: occurredAt.toISOString(),
            currentPeriodUsed: currentUsed,
            projectedCurrentPeriodUsed,
            softLimit,
            hardLimit,
            state: nextState,
            warning:
              nextState === "soft_limit_reached"
                ? "Included usage has been exhausted. Additional usage is billable."
                : nextState === "hard_limit_reached"
                  ? "The configured metered hard cap has been reached for the current billing period."
                  : null,
          } satisfies PolarBillingReportUsageResult);
        },
      }),
      integrationRoute.post(checkPath, {
        responseFormat: "json",
        async handler(request, ctx) {
          const body = (await request.json().catch(() => ({}))) as PolarBillingCheckInput;
          if (!body.key) {
            return new Response("A billing check key is required.", { status: 400 });
          }

          const amount =
            typeof body.amount === "number" && Number.isFinite(body.amount) && body.amount > 0
              ? body.amount
              : 1;

          const resolved = await requireOwner(ctx, billing, sdk);
          const active = resolveActiveProduct(resolved.state, products);
          const planId = active.product?.planId ?? "free";
          const plan = plans[planId] ?? {};
          const used = await resolveUsageValue({
            owner: resolved.owner,
            key: body.key,
            tools: resolved.tools,
            billing,
            state: resolved.state,
          });
          const limit = plan.limits?.[body.key] ?? null;
          const remaining =
            typeof used === "number" && typeof limit === "number"
              ? Math.max(limit - used, 0)
              : null;
          const allowed =
            typeof used === "number" && typeof limit === "number" ? used + amount <= limit : true;

          return Response.json({
            planId,
            key: body.key,
            amount,
            used,
            limit,
            remaining,
            allowed,
          } satisfies PolarBillingCheckResult);
        },
      }),
      integrationRoute.post(checkoutPath, {
        responseFormat: "json",
        async handler(request, ctx) {
          const body = (await request.json().catch(() => ({}))) as PolarCheckoutInput;
          if (!body.productId) {
            return new Response("A Polar product id is required.", { status: 400 });
          }

          const product = products.find((entry) => entry.id === body.productId);
          if (!product) {
            return new Response(`Unknown Polar product "${body.productId}".`, { status: 404 });
          }

          const resolved = await requireOwner(ctx, billing, sdk);
          const successPath =
            resolveAppPath(body.successPath ?? "/success", "Polar checkout successPath") ??
            "/success";
          const cancelPath =
            resolveAppPath(body.cancelPath ?? "/cancel", "Polar checkout cancelPath") ?? "/cancel";
          const successUrl = toAbsoluteUrl(successPath, request, appBaseUrl);
          successUrl.searchParams.set("checkout_id", "{CHECKOUT_ID}");
          const returnUrl = toAbsoluteUrl(cancelPath, request, appBaseUrl);
          const checkout = await sdk.checkouts.create({
            products: [product.productId],
            successUrl: successUrl.toString(),
            returnUrl: returnUrl.toString(),
            externalCustomerId: resolved.externalCustomerId,
            customerEmail: body.customerEmail ?? resolved.owner.email ?? null,
            metadata: body.metadata,
          });

          return Response.json({
            productId: product.id,
            planId: product.planId ?? null,
            checkoutId: checkout.id,
            redirectTo: checkout.url,
            mode: product.kind === "subscription" ? "subscription" : "payment",
          } satisfies PolarCheckoutResult);
        },
      }),
      integrationRoute.post(portalPath, {
        responseFormat: "json",
        async handler(request, ctx) {
          const body = (await request.json().catch(() => ({}))) as PolarPortalInput;
          const resolved = await requireOwner(ctx, billing, sdk);
          const returnPath = resolveAppPath(body.returnTo ?? "/", "Polar portal returnTo") ?? "/";
          const returnUrl = toAbsoluteUrl(returnPath, request, appBaseUrl);
          const session = await sdk.customerSessions.create({
            externalCustomerId: resolved.externalCustomerId,
            returnUrl: returnUrl.toString(),
          });

          return Response.json({
            customerId: session.customerId,
            redirectTo: session.customerPortalUrl,
          } satisfies PolarPortalResult);
        },
      }),
      ...webhookRoutes,
    ],
  });
}
