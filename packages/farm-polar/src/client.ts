import type { FarmIntegrationAPIOperation } from "@farm.js/core/client";
import { api } from "@farm.js/core/client";
import {
  createPathInferredClientApi,
  type InferPathInferredClientAPI,
  type PathInferredClientOperation,
} from "@farm.js/integration-utils/integration";

export type PolarBillingStatus =
  | "free"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete";

export type PolarBillingMeterState =
  | "ok"
  | "soft_limit_reached"
  | "hard_limit_reached"
  | "blocked_past_due"
  | "customer_missing"
  | "meter_missing";

export type PolarBillingUsageProperties = Record<string, string | number | boolean>;

export type PolarBillingProductKind = "subscription" | "one_time";

export interface PolarCatalogMeterPrice {
  key: string;
  eventName: string;
  meterId: string;
  unit: string | null;
  currency: string | null;
  unitAmountDecimal: string | null;
  capAmount: number | null;
  summary: string | null;
}

export interface PolarCatalogProduct {
  id: string;
  productId: string | null;
  name: string;
  description: string | null;
  kind: PolarBillingProductKind;
  planId: string | null;
  trialDays: number | null;
  public: boolean;
  currency: string | null;
  unitAmount: number | null;
  interval: "day" | "week" | "month" | "year" | null;
  intervalCount: number | null;
  meterPrices: PolarCatalogMeterPrice[];
  metadata: Record<string, string>;
}

export interface PolarCheckoutInput {
  productId: string;
  customerEmail?: string;
  successPath?: string;
  cancelPath?: string;
  metadata?: Record<string, string>;
}

export interface PolarCheckoutResult {
  productId: string;
  planId: string | null;
  checkoutId: string;
  redirectTo: string;
  mode: "payment" | "subscription";
}

export interface PolarPortalInput {
  returnTo?: string;
}

export interface PolarPortalResult {
  customerId: string;
  redirectTo: string;
}

export interface PolarBillingStatusResult {
  owner: {
    kind: "user" | "organization";
    id: string;
    email?: string;
  } | null;
  externalCustomerId: string | null;
  customerId: string | null;
  planId: string;
  productId: string | null;
  status: PolarBillingStatus;
  subscriptionId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  entitlements: Record<string, unknown>;
}

export interface PolarBillingFeaturesResult {
  planId: string;
  features: Record<string, boolean>;
}

export interface PolarBillingLimitsResult {
  planId: string;
  limits: Record<string, number>;
}

export interface PolarBillingUsageInput {
  key: string;
}

export interface PolarBillingUsageResult {
  planId: string;
  key: string;
  used: number | null;
  limit: number | null;
  remaining: number | null;
}

export interface PolarBillingMeterUsageInput {
  key: string;
}

export interface PolarBillingMeterUsageResult {
  planId: string;
  productId: string | null;
  key: string;
  eventName: string;
  meterId: string;
  meterName: string | null;
  aggregation: string;
  quantityMetadataKey: string | null;
  activeMeterIds: string[];
  customerId: string | null;
  subscriptionId: string | null;
  subscriptionStatus: PolarBillingStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  currentPeriodUsed: number;
  creditedUnits: number | null;
  balance: number | null;
  currency: string | null;
  baseSubscriptionAmount: number | null;
  meterUnitAmount: string | null;
  meterCapAmount: number | null;
  chargeSource: "subscription_meter" | "catalog_rate";
  estimatedMeterChargeAmount: number | null;
  estimatedCombinedAmount: number | null;
  includedLimit: number | null;
  softLimit: number | null;
  hardLimit: number | null;
  remainingIncluded: number | null;
  remainingHard: number | null;
  state: PolarBillingMeterState;
  warning: string | null;
}

export type PolarBillingCurrentChargeLineKind = "base_subscription" | "metered_usage";

export interface PolarBillingCurrentChargeLine {
  key: string | null;
  kind: PolarBillingCurrentChargeLineKind;
  label: string;
  amount: number | null;
  currency: string;
  quantity: number | null;
  includedUnits: number | null;
  overageUnits: number | null;
  billedBuckets: number | null;
  billingUnits: number | null;
  unitAmountDecimal: string | null;
}

export interface PolarBillingCurrentChargesResult {
  owner: {
    kind: "user" | "organization";
    id: string;
    email?: string;
  } | null;
  externalCustomerId: string | null;
  customerId: string | null;
  planId: string;
  productId: string | null;
  subscriptionId: string | null;
  subscriptionStatus: PolarBillingStatus;
  currency: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  baseSubscriptionAmount: number | null;
  pendingMeterChargeAmount: number | null;
  estimatedTotalAmount: number | null;
  lineItems: PolarBillingCurrentChargeLine[];
}

export interface PolarBillingReportUsageInput {
  key: string;
  quantity: number;
  idempotencyKey: string;
  occurredAt?: string;
  properties?: PolarBillingUsageProperties;
}

export interface PolarBillingReportUsageResult {
  key: string;
  quantity: number;
  customerId: string | null;
  eventName: string;
  eventIdentifier: string;
  occurredAt: string;
  currentPeriodUsed: number | null;
  projectedCurrentPeriodUsed: number | null;
  softLimit: number | null;
  hardLimit: number | null;
  state: PolarBillingMeterState;
  warning: string | null;
}

export interface PolarBillingCheckInput {
  key: string;
  amount?: number;
}

export interface PolarBillingCheckResult {
  planId: string;
  key: string;
  amount: number;
  used: number | null;
  limit: number | null;
  remaining: number | null;
  allowed: boolean;
}

export interface PolarClientPathOptions {
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
}

type ResolvedPolarClientPath<
  TPath extends string | undefined,
  TDefault extends string,
> = TPath extends string ? TPath : TDefault;

type PolarDefaultClientPaths = {
  productsPath: "/billing/products";
  statusPath: "/billing/status";
  currentChargesPath: "/billing/current-charges";
  featuresPath: "/billing/features";
  limitsPath: "/billing/limits";
  usagePath: "/billing/usage";
  meterUsagePath: "/billing/meter-usage";
  reportUsagePath: "/billing/report-usage";
  checkPath: "/billing/check";
  checkoutPath: "/billing/checkout";
  portalPath: "/billing/portal";
};

type PolarGetOperation<TResponse> = FarmIntegrationAPIOperation<
  never,
  never,
  TResponse,
  false,
  "GET"
>;

type PolarPostOperation<TBody, TResponse> = FarmIntegrationAPIOperation<
  TBody,
  never,
  TResponse,
  false,
  "POST"
>;

type PolarClientEntry<
  TPath extends string,
  TOperation extends FarmIntegrationAPIOperation<any, any, any, any, any>,
> = PathInferredClientOperation<TPath, TOperation>;

type PolarClientEntries<TInput extends PolarClientPathOptions = {}> = [
  PolarClientEntry<
    ResolvedPolarClientPath<TInput["productsPath"], "/billing/products">,
    PolarGetOperation<PolarCatalogProduct[]>
  >,
  PolarClientEntry<
    ResolvedPolarClientPath<TInput["statusPath"], "/billing/status">,
    PolarGetOperation<PolarBillingStatusResult>
  >,
  PolarClientEntry<
    ResolvedPolarClientPath<TInput["currentChargesPath"], "/billing/current-charges">,
    PolarGetOperation<PolarBillingCurrentChargesResult>
  >,
  PolarClientEntry<
    ResolvedPolarClientPath<TInput["featuresPath"], "/billing/features">,
    PolarGetOperation<PolarBillingFeaturesResult>
  >,
  PolarClientEntry<
    ResolvedPolarClientPath<TInput["limitsPath"], "/billing/limits">,
    PolarGetOperation<PolarBillingLimitsResult>
  >,
  PolarClientEntry<
    ResolvedPolarClientPath<TInput["usagePath"], "/billing/usage">,
    PolarPostOperation<PolarBillingUsageInput, PolarBillingUsageResult>
  >,
  PolarClientEntry<
    ResolvedPolarClientPath<TInput["meterUsagePath"], "/billing/meter-usage">,
    PolarPostOperation<PolarBillingMeterUsageInput, PolarBillingMeterUsageResult>
  >,
  PolarClientEntry<
    ResolvedPolarClientPath<TInput["reportUsagePath"], "/billing/report-usage">,
    PolarPostOperation<PolarBillingReportUsageInput, PolarBillingReportUsageResult>
  >,
  PolarClientEntry<
    ResolvedPolarClientPath<TInput["checkPath"], "/billing/check">,
    PolarPostOperation<PolarBillingCheckInput, PolarBillingCheckResult>
  >,
  PolarClientEntry<
    ResolvedPolarClientPath<TInput["checkoutPath"], "/billing/checkout">,
    PolarPostOperation<PolarCheckoutInput, PolarCheckoutResult>
  >,
  PolarClientEntry<
    ResolvedPolarClientPath<TInput["portalPath"], "/billing/portal">,
    PolarPostOperation<PolarPortalInput, PolarPortalResult>
  >,
];

export type PolarClientAPI<TInput extends PolarClientPathOptions = {}> = InferPathInferredClientAPI<
  PolarClientEntries<TInput>
>;

export type PolarDefaultClientAPI = InferPathInferredClientAPI<
  PolarClientEntries<PolarDefaultClientPaths>
>;

export function createPolarClientApi(): PolarDefaultClientAPI;
export function createPolarClientApi<const TInput extends PolarClientPathOptions>(
  input: TInput,
): PolarClientAPI<TInput>;
export function createPolarClientApi<TInput extends PolarClientPathOptions>(
  input?: TInput,
): PolarDefaultClientAPI | PolarClientAPI<TInput> {
  const productsPath = (input?.productsPath ?? "/billing/products") as ResolvedPolarClientPath<
    TInput["productsPath"],
    "/billing/products"
  >;
  const statusPath = (input?.statusPath ?? "/billing/status") as ResolvedPolarClientPath<
    TInput["statusPath"],
    "/billing/status"
  >;
  const currentChargesPath = (input?.currentChargesPath ??
    "/billing/current-charges") as ResolvedPolarClientPath<
    TInput["currentChargesPath"],
    "/billing/current-charges"
  >;
  const featuresPath = (input?.featuresPath ?? "/billing/features") as ResolvedPolarClientPath<
    TInput["featuresPath"],
    "/billing/features"
  >;
  const limitsPath = (input?.limitsPath ?? "/billing/limits") as ResolvedPolarClientPath<
    TInput["limitsPath"],
    "/billing/limits"
  >;
  const usagePath = (input?.usagePath ?? "/billing/usage") as ResolvedPolarClientPath<
    TInput["usagePath"],
    "/billing/usage"
  >;
  const meterUsagePath = (input?.meterUsagePath ??
    "/billing/meter-usage") as ResolvedPolarClientPath<
    TInput["meterUsagePath"],
    "/billing/meter-usage"
  >;
  const reportUsagePath = (input?.reportUsagePath ??
    "/billing/report-usage") as ResolvedPolarClientPath<
    TInput["reportUsagePath"],
    "/billing/report-usage"
  >;
  const checkPath = (input?.checkPath ?? "/billing/check") as ResolvedPolarClientPath<
    TInput["checkPath"],
    "/billing/check"
  >;
  const checkoutPath = (input?.checkoutPath ?? "/billing/checkout") as ResolvedPolarClientPath<
    TInput["checkoutPath"],
    "/billing/checkout"
  >;
  const portalPath = (input?.portalPath ?? "/billing/portal") as ResolvedPolarClientPath<
    TInput["portalPath"],
    "/billing/portal"
  >;

  return createPathInferredClientApi(
    {
      path: productsPath,
      operation: api.get<PolarCatalogProduct[]>(productsPath, {
        responseFormat: "json",
      }),
    },
    {
      path: statusPath,
      operation: api.get<PolarBillingStatusResult>(statusPath, {
        responseFormat: "json",
      }),
    },
    {
      path: currentChargesPath,
      operation: api.get<PolarBillingCurrentChargesResult>(currentChargesPath, {
        responseFormat: "json",
      }),
    },
    {
      path: featuresPath,
      operation: api.get<PolarBillingFeaturesResult>(featuresPath, {
        responseFormat: "json",
      }),
    },
    {
      path: limitsPath,
      operation: api.get<PolarBillingLimitsResult>(limitsPath, {
        responseFormat: "json",
      }),
    },
    {
      path: usagePath,
      operation: api.post<PolarBillingUsageInput, PolarBillingUsageResult>(usagePath, {
        responseFormat: "json",
      }),
    },
    {
      path: meterUsagePath,
      operation: api.post<PolarBillingMeterUsageInput, PolarBillingMeterUsageResult>(
        meterUsagePath,
        {
          responseFormat: "json",
        },
      ),
    },
    {
      path: reportUsagePath,
      operation: api.post<PolarBillingReportUsageInput, PolarBillingReportUsageResult>(
        reportUsagePath,
        {
          responseFormat: "json",
        },
      ),
    },
    {
      path: checkPath,
      operation: api.post<PolarBillingCheckInput, PolarBillingCheckResult>(checkPath, {
        responseFormat: "json",
      }),
    },
    {
      path: checkoutPath,
      operation: api.post<PolarCheckoutInput, PolarCheckoutResult>(checkoutPath, {
        responseFormat: "json",
      }),
    },
    {
      path: portalPath,
      operation: api.post<PolarPortalInput, PolarPortalResult>(portalPath, {
        responseFormat: "json",
      }),
    },
  ) as PolarDefaultClientAPI | PolarClientAPI<TInput>;
}

export const polarClient: PolarDefaultClientAPI = createPolarClientApi();
