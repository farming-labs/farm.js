import type { FarmIntegrationAPIOperation } from "@farm.js/core/client";
import { api } from "@farm.js/core/client";
import {
  createPathInferredClientApi,
  type InferPathInferredClientAPI,
  type PathInferredClientOperation,
} from "../utils/integration.js";
import type { FarmWebhookAckResult } from "../utils/webhooks.js";
import type { StripeBillingMeterState, StripeBillingUsageProperties } from "./storage.js";

export type StripeBillingSeatsMode = "plan_limit" | "subscription_quantity";
export type StripeBillingSeatLimitSource =
  | "plan_limit"
  | "subscription_quantity"
  | "override"
  | "none";
export type StripeCheckoutTrialBehavior = "if_eligible" | "require" | "none";
export type StripeBillingUpgradeProrationBehavior = "always_invoice" | "create_prorations" | "none";

export interface StripeIntegrationProduct {
  id: string;
  name?: string;
  description?: string;
  priceId?: string;
  seatPriceId?: string;
  meterPriceIds?: Record<string, string>;
  lookupKey?: string;
  currency?: string;
  unitAmount?: number;
  mode?: "payment" | "subscription";
  interval?: "day" | "week" | "month" | "year";
  intervalCount?: number;
  quantity?: number;
  seatBilling?: "line_item_quantity" | "included_plus_add_on";
  imageUrl?: string;
  metadata?: Record<string, string>;
}

export type StripeBillingProductKind = "subscription" | "one_time";

export interface StripeCatalogMeterPrice {
  key: string;
  eventName: string;
  unit: string | null;
  priceId: string;
  currency: string | null;
  billingScheme: "per_unit" | "tiered" | null;
  tiersMode: "graduated" | "volume" | null;
  unitAmount: number | null;
  unitAmountDecimal: string | null;
  summary: string | null;
}

export interface StripeCatalogProduct {
  id: string;
  name: string;
  description: string | null;
  kind: StripeBillingProductKind;
  planId: string | null;
  trialDays: number | null;
  public: boolean;
  currency: string | null;
  unitAmount: number | null;
  mode: "payment" | "subscription";
  interval: "day" | "week" | "month" | "year" | null;
  intervalCount: number | null;
  quantity: number;
  seatBilling: "line_item_quantity" | "included_plus_add_on" | null;
  hasSeatPrice: boolean;
  seatUnitAmount: number | null;
  seatCurrency: string | null;
  meterPrices: StripeCatalogMeterPrice[];
  priceId: string | null;
  productId: string | null;
  lookupKey: string | null;
  metadata: Record<string, string>;
}

export interface StripeCheckoutInput {
  productId: string;
  quantity?: number;
  customerEmail?: string;
  successPath?: string;
  cancelPath?: string;
  trialBehavior?: StripeCheckoutTrialBehavior;
  metadata?: Record<string, string>;
}

export interface StripeCheckoutResult {
  productId: string;
  planId: string | null;
  sessionId: string;
  redirectTo: string;
  mode: "payment" | "subscription";
  trialApplied: boolean;
  trialDays: number | null;
}

export interface StripeBillingUpgradeInput {
  quantity: number;
  prorationBehavior?: StripeBillingUpgradeProrationBehavior;
}

export interface StripeBillingUpgradeResult {
  planId: string;
  productId: string | null;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  seatQuantity: number | null;
}

export type StripeBillingChangeProrationBehavior = StripeBillingUpgradeProrationBehavior;
export type StripeBillingChangeInput = StripeBillingUpgradeInput;
export type StripeBillingChangeResult = StripeBillingUpgradeResult;

export interface StripePortalInput {
  sessionId?: string;
  customerId?: string;
  returnTo?: string;
}

export interface StripePortalResult {
  customerId: string;
  redirectTo: string;
}

export interface StripeSessionQuery {
  sessionId: string;
}

export interface StripeSessionLineItemResult {
  description: string | null;
  quantity: number | null;
  amountSubtotal: number | null;
  amountTotal: number | null;
  currency: string | null;
  priceId?: string | null;
  productId?: string | null;
}

export interface StripeSessionResult {
  id: string;
  status: string | null;
  paymentStatus: string | null;
  mode: "payment" | "subscription" | null;
  customerId: string | null;
  customerEmail: string | null;
  subscriptionId?: string | null;
  subscriptionStatus?: string | null;
  currentPeriodEnd?: string | null;
  trialEndsAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  amountSubtotal: number | null;
  amountTotal: number | null;
  currency: string | null;
  metadata: Record<string, string>;
  lineItems: StripeSessionLineItemResult[];
}

export interface StripeBillingStatusResult {
  owner: {
    kind: "user" | "organization";
    id: string;
    email?: string;
  } | null;
  planId: string;
  productId: string | null;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  trialUsedAt: string | null;
  seatMode: StripeBillingSeatsMode;
  seatQuantity: number | null;
  seatAllowanceOverride: number | null;
  seatLimitSource: StripeBillingSeatLimitSource;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  entitlements: Record<string, unknown>;
}

export interface StripeBillingFeaturesResult {
  planId: string;
  features: Record<string, boolean>;
}

export interface StripeBillingLimitsResult {
  planId: string;
  limits: Record<string, number>;
}

export interface StripeBillingUsageInput {
  key: string;
}

export interface StripeBillingUsageResult {
  planId: string;
  key: string;
  used: number | null;
  limit: number | null;
  remaining: number | null;
}

export interface StripeBillingMeterUsageInput {
  key: string;
}

export interface StripeBillingMeterUsageResult {
  planId: string;
  productId: string | null;
  key: string;
  eventName: string;
  customerId: string;
  subscriptionId: string | null;
  subscriptionStatus: string;
  attached: boolean;
  attachedPriceId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  currentPeriodUsed: number;
  includedLimit: number | null;
  softLimit: number | null;
  hardLimit: number | null;
  remainingIncluded: number | null;
  remainingHard: number | null;
  state: StripeBillingMeterState;
  warning: string | null;
}

export type StripeBillingCurrentChargeLineKind =
  | "base_subscription"
  | "seat_add_on"
  | "proration"
  | "metered_usage"
  | "other";

export interface StripeBillingCurrentChargeLine {
  key: string | null;
  kind: StripeBillingCurrentChargeLineKind;
  label: string;
  amount: number | null;
  currency: string;
  quantity: number | null;
  includedUnits: number | null;
  overageUnits: number | null;
  billedBuckets: number | null;
  billingUnits: number | null;
  unitAmountDecimal: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  meterKey: string | null;
}

export interface StripeBillingCurrentChargesResult {
  owner: {
    kind: "user" | "organization";
    id: string;
    email?: string;
  } | null;
  planId: string;
  productId: string | null;
  customerId: string;
  subscriptionId: string | null;
  subscriptionStatus: string;
  currency: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  baseSubscriptionAmount: number | null;
  pendingMeterChargeAmount: number | null;
  estimatedTotalAmount: number | null;
  lineItems: StripeBillingCurrentChargeLine[];
}

export type StripeBillingUpcomingInvoiceLineKind =
  | "base_subscription"
  | "seat_add_on"
  | "proration"
  | "metered"
  | "other";

export interface StripeBillingUpcomingInvoiceLineResult {
  description: string | null;
  kind: StripeBillingUpcomingInvoiceLineKind;
  quantity: number | null;
  amount: number | null;
  currency: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  priceId: string | null;
  stripeProductId: string | null;
  meterKey: string | null;
}

export interface StripeBillingUpcomingInvoiceTotalsResult {
  recurring: number;
  prorations: number;
  metered: number;
  other: number;
  total: number;
}

export interface StripeBillingUpcomingInvoiceResult {
  planId: string;
  productId: string | null;
  customerId: string;
  subscriptionId: string | null;
  subscriptionStatus: string;
  nextBillingAt: string | null;
  currency: string | null;
  generatedAt: string;
  monthlyMeteringActive: boolean;
  note: string | null;
  totals: StripeBillingUpcomingInvoiceTotalsResult;
  lines: StripeBillingUpcomingInvoiceLineResult[];
}

export interface StripeBillingReportUsageInput {
  key: string;
  quantity: number;
  idempotencyKey: string;
  occurredAt?: string;
  properties?: StripeBillingUsageProperties;
}

export interface StripeBillingReportUsageResult {
  key: string;
  quantity: number;
  customerId: string;
  stripeEventName: string;
  stripeEventIdentifier: string;
  occurredAt: string;
  currentPeriodUsed?: number | null;
  projectedCurrentPeriodUsed?: number | null;
  softLimit?: number | null;
  hardLimit?: number | null;
  state?: StripeBillingMeterState;
  warning?: string | null;
}

export interface StripeBillingCheckInput {
  key: string;
  amount?: number;
}

export interface StripeBillingCheckResult {
  planId: string;
  key: string;
  amount: number;
  used: number | null;
  limit: number | null;
  remaining: number | null;
  allowed: boolean;
}

export interface StripeWebhookResult extends FarmWebhookAckResult {
  provider: "stripe";
}

export interface StripeClientPathOptions {
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

type ResolvedStripeClientPath<
  TPath extends string | undefined,
  TDefault extends string,
> = TPath extends string ? TPath : TDefault;

type StripeDefaultClientPaths = {
  productsPath: "/billing/products";
  statusPath: "/billing/status";
  currentChargesPath: "/billing/current-charges";
  featuresPath: "/billing/features";
  limitsPath: "/billing/limits";
  usagePath: "/billing/usage";
  meterUsagePath: "/billing/meter-usage";
  upcomingInvoicePath: "/billing/upcoming-invoice";
  reportUsagePath: "/billing/report-usage";
  checkPath: "/billing/check";
  checkoutPath: "/billing/checkout";
  upgradePath: "/billing/upgrade";
  portalPath: "/billing/portal";
  sessionPath: "/billing/session";
};

type StripeGetOperation<TResponse, TQuery = never> = FarmIntegrationAPIOperation<
  never,
  TQuery,
  TResponse,
  false,
  "GET"
>;

type StripePostOperation<TBody, TResponse> = FarmIntegrationAPIOperation<
  TBody,
  never,
  TResponse,
  false,
  "POST"
>;

type StripeClientEntry<
  TPath extends string,
  TOperation extends FarmIntegrationAPIOperation<any, any, any, any, any>,
  TLeafName extends string | undefined = undefined,
> = PathInferredClientOperation<TPath, TOperation, TLeafName>;

type StripeClientEntries<TInput extends StripeClientPathOptions = {}> = [
  StripeClientEntry<
    ResolvedStripeClientPath<TInput["productsPath"], "/billing/products">,
    StripeGetOperation<StripeCatalogProduct[]>
  >,
  StripeClientEntry<
    ResolvedStripeClientPath<TInput["statusPath"], "/billing/status">,
    StripeGetOperation<StripeBillingStatusResult>
  >,
  StripeClientEntry<
    ResolvedStripeClientPath<TInput["currentChargesPath"], "/billing/current-charges">,
    StripeGetOperation<StripeBillingCurrentChargesResult>
  >,
  StripeClientEntry<
    ResolvedStripeClientPath<TInput["featuresPath"], "/billing/features">,
    StripeGetOperation<StripeBillingFeaturesResult>
  >,
  StripeClientEntry<
    ResolvedStripeClientPath<TInput["limitsPath"], "/billing/limits">,
    StripeGetOperation<StripeBillingLimitsResult>
  >,
  StripeClientEntry<
    ResolvedStripeClientPath<TInput["usagePath"], "/billing/usage">,
    StripePostOperation<StripeBillingUsageInput, StripeBillingUsageResult>
  >,
  StripeClientEntry<
    ResolvedStripeClientPath<TInput["meterUsagePath"], "/billing/meter-usage">,
    StripePostOperation<StripeBillingMeterUsageInput, StripeBillingMeterUsageResult>
  >,
  StripeClientEntry<
    ResolvedStripeClientPath<TInput["upcomingInvoicePath"], "/billing/upcoming-invoice">,
    StripeGetOperation<StripeBillingUpcomingInvoiceResult>
  >,
  StripeClientEntry<
    ResolvedStripeClientPath<TInput["reportUsagePath"], "/billing/report-usage">,
    StripePostOperation<StripeBillingReportUsageInput, StripeBillingReportUsageResult>
  >,
  StripeClientEntry<
    ResolvedStripeClientPath<TInput["checkPath"], "/billing/check">,
    StripePostOperation<StripeBillingCheckInput, StripeBillingCheckResult>
  >,
  StripeClientEntry<
    ResolvedStripeClientPath<TInput["checkoutPath"], "/billing/checkout">,
    StripePostOperation<StripeCheckoutInput, StripeCheckoutResult>
  >,
  StripeClientEntry<
    ResolvedStripeClientPath<TInput["upgradePath"], "/billing/upgrade">,
    StripePostOperation<StripeBillingUpgradeInput, StripeBillingUpgradeResult>
  >,
  StripeClientEntry<
    ResolvedStripeClientPath<TInput["upgradePath"], "/billing/upgrade">,
    StripePostOperation<StripeBillingChangeInput, StripeBillingChangeResult>,
    "change"
  >,
  StripeClientEntry<
    ResolvedStripeClientPath<TInput["portalPath"], "/billing/portal">,
    StripePostOperation<StripePortalInput, StripePortalResult>
  >,
  StripeClientEntry<
    ResolvedStripeClientPath<TInput["sessionPath"], "/billing/session">,
    StripeGetOperation<StripeSessionResult, StripeSessionQuery>
  >,
];

export type StripeClientAPI<TInput extends StripeClientPathOptions = {}> =
  InferPathInferredClientAPI<StripeClientEntries<TInput>>;

export type StripeDefaultClientAPI = InferPathInferredClientAPI<
  StripeClientEntries<StripeDefaultClientPaths>
>;

export function createStripeClientApi(): StripeDefaultClientAPI;
export function createStripeClientApi<const TInput extends StripeClientPathOptions>(
  input: TInput,
): StripeClientAPI<TInput>;
export function createStripeClientApi<TInput extends StripeClientPathOptions>(
  input?: TInput,
): StripeDefaultClientAPI | StripeClientAPI<TInput> {
  const productsPath = (input?.productsPath ?? "/billing/products") as ResolvedStripeClientPath<
    TInput["productsPath"],
    "/billing/products"
  >;
  const statusPath = (input?.statusPath ?? "/billing/status") as ResolvedStripeClientPath<
    TInput["statusPath"],
    "/billing/status"
  >;
  const currentChargesPath = (input?.currentChargesPath ??
    "/billing/current-charges") as ResolvedStripeClientPath<
    TInput["currentChargesPath"],
    "/billing/current-charges"
  >;
  const featuresPath = (input?.featuresPath ?? "/billing/features") as ResolvedStripeClientPath<
    TInput["featuresPath"],
    "/billing/features"
  >;
  const limitsPath = (input?.limitsPath ?? "/billing/limits") as ResolvedStripeClientPath<
    TInput["limitsPath"],
    "/billing/limits"
  >;
  const usagePath = (input?.usagePath ?? "/billing/usage") as ResolvedStripeClientPath<
    TInput["usagePath"],
    "/billing/usage"
  >;
  const meterUsagePath = (input?.meterUsagePath ??
    "/billing/meter-usage") as ResolvedStripeClientPath<
    TInput["meterUsagePath"],
    "/billing/meter-usage"
  >;
  const upcomingInvoicePath = (input?.upcomingInvoicePath ??
    "/billing/upcoming-invoice") as ResolvedStripeClientPath<
    TInput["upcomingInvoicePath"],
    "/billing/upcoming-invoice"
  >;
  const reportUsagePath = (input?.reportUsagePath ??
    "/billing/report-usage") as ResolvedStripeClientPath<
    TInput["reportUsagePath"],
    "/billing/report-usage"
  >;
  const checkPath = (input?.checkPath ?? "/billing/check") as ResolvedStripeClientPath<
    TInput["checkPath"],
    "/billing/check"
  >;
  const checkoutPath = (input?.checkoutPath ?? "/billing/checkout") as ResolvedStripeClientPath<
    TInput["checkoutPath"],
    "/billing/checkout"
  >;
  const upgradePath = (input?.upgradePath ?? "/billing/upgrade") as ResolvedStripeClientPath<
    TInput["upgradePath"],
    "/billing/upgrade"
  >;
  const portalPath = (input?.portalPath ?? "/billing/portal") as ResolvedStripeClientPath<
    TInput["portalPath"],
    "/billing/portal"
  >;
  const sessionPath = (input?.sessionPath ?? "/billing/session") as ResolvedStripeClientPath<
    TInput["sessionPath"],
    "/billing/session"
  >;

  return createPathInferredClientApi(
    {
      path: productsPath,
      operation: api.get<StripeCatalogProduct[]>(productsPath, {
        responseFormat: "json",
      }),
    },
    {
      path: statusPath,
      operation: api.get<StripeBillingStatusResult>(statusPath, {
        responseFormat: "json",
      }),
    },
    {
      path: currentChargesPath,
      operation: api.get<StripeBillingCurrentChargesResult>(currentChargesPath, {
        responseFormat: "json",
      }),
    },
    {
      path: featuresPath,
      operation: api.get<StripeBillingFeaturesResult>(featuresPath, {
        responseFormat: "json",
      }),
    },
    {
      path: limitsPath,
      operation: api.get<StripeBillingLimitsResult>(limitsPath, {
        responseFormat: "json",
      }),
    },
    {
      path: usagePath,
      operation: api.post<StripeBillingUsageInput, StripeBillingUsageResult>(usagePath, {
        responseFormat: "json",
      }),
    },
    {
      path: meterUsagePath,
      operation: api.post<StripeBillingMeterUsageInput, StripeBillingMeterUsageResult>(
        meterUsagePath,
        {
          responseFormat: "json",
        },
      ),
    },
    {
      path: upcomingInvoicePath,
      operation: api.get<StripeBillingUpcomingInvoiceResult>(upcomingInvoicePath, {
        responseFormat: "json",
      }),
    },
    {
      path: reportUsagePath,
      operation: api.post<StripeBillingReportUsageInput, StripeBillingReportUsageResult>(
        reportUsagePath,
        {
          responseFormat: "json",
        },
      ),
    },
    {
      path: checkPath,
      operation: api.post<StripeBillingCheckInput, StripeBillingCheckResult>(checkPath, {
        responseFormat: "json",
      }),
    },
    {
      path: checkoutPath,
      operation: api.post<StripeCheckoutInput, StripeCheckoutResult>(checkoutPath, {
        responseFormat: "json",
      }),
    },
    {
      path: upgradePath,
      operation: api.post<StripeBillingUpgradeInput, StripeBillingUpgradeResult>(upgradePath, {
        responseFormat: "json",
      }),
    },
    {
      path: upgradePath,
      leafName: "change" as const,
      operation: api.post<StripeBillingChangeInput, StripeBillingChangeResult>(upgradePath, {
        responseFormat: "json",
      }),
    },
    {
      path: portalPath,
      operation: api.post<StripePortalInput, StripePortalResult>(portalPath, {
        responseFormat: "json",
      }),
    },
    {
      path: sessionPath,
      operation: api.get<StripeSessionQuery, StripeSessionResult>(sessionPath, {
        responseFormat: "json",
      }),
    },
  ) as StripeDefaultClientAPI | StripeClientAPI<TInput>;
}

export const stripeClient: StripeDefaultClientAPI = createStripeClientApi();
