import type { FarmIntegrationAPIOperation } from "@farmjs/core/client";
import { api } from "@farmjs/core/client";
import {
  createPathInferredClientApi,
  type InferPathInferredClientAPI,
  type PathInferredClientOperation,
} from "../utils/integration.js";
import type { FarmWebhookAckResult } from "../utils/webhooks.js";

export type AutumnBillingStatus =
  | "free"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "scheduled";

export type AutumnBillingMeterState =
  | "ok"
  | "soft_limit_reached"
  | "hard_limit_reached"
  | "blocked_past_due"
  | "meter_missing"
  | "feature_missing";

export type AutumnBillingUsageProperties = Record<string, string | number | boolean>;

export type AutumnBillingProductKind = "subscription" | "one_time";

export interface AutumnCatalogMeterPrice {
  key: string;
  eventName: string;
  featureId: string;
  unit: string | null;
  currency: string | null;
  unitAmountDecimal: string | null;
  capAmount: number | null;
  billingUnits: number | null;
  includedUnits: number | null;
  maxPurchaseUnits: number | null;
  summary: string | null;
}

export interface AutumnCatalogProduct {
  id: string;
  autumnPlanId: string | null;
  name: string;
  description: string | null;
  kind: AutumnBillingProductKind;
  planId: string | null;
  trialDays: number | null;
  public: boolean;
  currency: string | null;
  unitAmount: number | null;
  interval: "day" | "week" | "month" | "year" | null;
  intervalCount: number | null;
  meterPrices: AutumnCatalogMeterPrice[];
  metadata: Record<string, string>;
}

export interface AutumnCheckoutInput {
  productId: string;
  customerEmail?: string;
  successPath?: string;
  cancelPath?: string;
  metadata?: Record<string, string>;
}

export interface AutumnCheckoutResult {
  productId: string;
  planId: string | null;
  customerId: string;
  redirectTo: string;
  requiredActionCode: string | null;
}

export interface AutumnPortalInput {
  returnTo?: string;
}

export interface AutumnPortalResult {
  customerId: string;
  redirectTo: string;
}

export interface AutumnBillingInvoice {
  stripeInvoiceId: string;
  planIds: string[];
  status: string;
  totalAmount: number;
  currency: string;
  createdAt: string;
  hostedInvoiceUrl: string | null;
}

export interface AutumnBillingCurrentChargeLine {
  key: string | null;
  kind: "base_subscription" | "metered_usage";
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

export interface AutumnBillingCurrentChargesResult {
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
  currency: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  baseSubscriptionAmount: number | null;
  pendingMeterChargeAmount: number | null;
  estimatedTotalAmount: number | null;
  lineItems: AutumnBillingCurrentChargeLine[];
}

export interface AutumnBillingInvoicesResult {
  owner: {
    kind: "user" | "organization";
    id: string;
    email?: string;
  } | null;
  externalCustomerId: string | null;
  customerId: string | null;
  invoices: AutumnBillingInvoice[];
}

export interface AutumnBillingStatusResult {
  owner: {
    kind: "user" | "organization";
    id: string;
    email?: string;
  } | null;
  externalCustomerId: string | null;
  customerId: string | null;
  planId: string;
  productId: string | null;
  status: AutumnBillingStatus;
  subscriptionId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  entitlements: Record<string, unknown>;
}

export interface AutumnBillingFeaturesResult {
  planId: string;
  features: Record<string, boolean>;
}

export interface AutumnBillingLimitsResult {
  planId: string;
  limits: Record<string, number>;
}

export interface AutumnBillingUsageInput {
  key: string;
}

export interface AutumnBillingUsageResult {
  planId: string;
  key: string;
  used: number | null;
  limit: number | null;
  remaining: number | null;
}

export interface AutumnBillingMeterUsageInput {
  key: string;
}

export interface AutumnBillingMeterUsageResult {
  planId: string;
  productId: string | null;
  key: string;
  eventName: string;
  meterId: string;
  meterName: string | null;
  unit: string | null;
  aggregation: string;
  quantityMetadataKey: string | null;
  activeMeterIds: string[];
  customerId: string | null;
  subscriptionId: string | null;
  subscriptionStatus: AutumnBillingStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  currentPeriodUsed: number;
  creditedUnits: number | null;
  balance: number | null;
  currency: string | null;
  baseSubscriptionAmount: number | null;
  meterUnitAmount: string | null;
  meterCapAmount: number | null;
  billingUnits: number | null;
  chargeSource: "balance" | "catalog_rate" | "subscription_meter";
  estimatedMeterChargeAmount: number | null;
  estimatedCombinedAmount: number | null;
  includedLimit: number | null;
  softLimit: number | null;
  hardLimit: number | null;
  remainingIncluded: number | null;
  remainingHard: number | null;
  state: AutumnBillingMeterState;
  warning: string | null;
}

export interface AutumnBillingReportUsageInput {
  key: string;
  quantity: number;
  idempotencyKey: string;
  occurredAt?: string;
  properties?: AutumnBillingUsageProperties;
}

export interface AutumnBillingReportUsageResult {
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
  state: AutumnBillingMeterState;
  warning: string | null;
}

export interface AutumnBillingCheckInput {
  key: string;
  amount?: number;
}

export interface AutumnBillingCheckResult {
  planId: string;
  key: string;
  amount: number;
  used: number | null;
  limit: number | null;
  remaining: number | null;
  allowed: boolean;
}

export interface AutumnWebhookResult extends FarmWebhookAckResult {
  provider: "autumn";
}

export interface AutumnClientPathOptions {
  productsPath?: string;
  statusPath?: string;
  currentChargesPath?: string;
  invoicesPath?: string;
  featuresPath?: string;
  limitsPath?: string;
  usagePath?: string;
  meterUsagePath?: string;
  reportUsagePath?: string;
  checkPath?: string;
  checkoutPath?: string;
  portalPath?: string;
}

type ResolvedAutumnClientPath<
  TPath extends string | undefined,
  TDefault extends string,
> = TPath extends string ? TPath : TDefault;

type AutumnDefaultClientPaths = {
  productsPath: "/billing/products";
  statusPath: "/billing/status";
  currentChargesPath: "/billing/current-charges";
  invoicesPath: "/billing/invoices";
  featuresPath: "/billing/features";
  limitsPath: "/billing/limits";
  usagePath: "/billing/usage";
  meterUsagePath: "/billing/meter-usage";
  reportUsagePath: "/billing/report-usage";
  checkPath: "/billing/check";
  checkoutPath: "/billing/checkout";
  portalPath: "/billing/portal";
};

type AutumnGetOperation<TResponse> = FarmIntegrationAPIOperation<
  never,
  never,
  TResponse,
  false,
  "GET"
>;

type AutumnPostOperation<TBody, TResponse> = FarmIntegrationAPIOperation<
  TBody,
  never,
  TResponse,
  false,
  "POST"
>;

type AutumnClientEntry<
  TPath extends string,
  TOperation extends FarmIntegrationAPIOperation<any, any, any, any, any>,
> = PathInferredClientOperation<TPath, TOperation>;

type AutumnClientEntries<TInput extends AutumnClientPathOptions = {}> = [
  AutumnClientEntry<
    ResolvedAutumnClientPath<TInput["productsPath"], "/billing/products">,
    AutumnGetOperation<AutumnCatalogProduct[]>
  >,
  AutumnClientEntry<
    ResolvedAutumnClientPath<TInput["statusPath"], "/billing/status">,
    AutumnGetOperation<AutumnBillingStatusResult>
  >,
  AutumnClientEntry<
    ResolvedAutumnClientPath<TInput["currentChargesPath"], "/billing/current-charges">,
    AutumnGetOperation<AutumnBillingCurrentChargesResult>
  >,
  AutumnClientEntry<
    ResolvedAutumnClientPath<TInput["invoicesPath"], "/billing/invoices">,
    AutumnGetOperation<AutumnBillingInvoicesResult>
  >,
  AutumnClientEntry<
    ResolvedAutumnClientPath<TInput["featuresPath"], "/billing/features">,
    AutumnGetOperation<AutumnBillingFeaturesResult>
  >,
  AutumnClientEntry<
    ResolvedAutumnClientPath<TInput["limitsPath"], "/billing/limits">,
    AutumnGetOperation<AutumnBillingLimitsResult>
  >,
  AutumnClientEntry<
    ResolvedAutumnClientPath<TInput["usagePath"], "/billing/usage">,
    AutumnPostOperation<AutumnBillingUsageInput, AutumnBillingUsageResult>
  >,
  AutumnClientEntry<
    ResolvedAutumnClientPath<TInput["meterUsagePath"], "/billing/meter-usage">,
    AutumnPostOperation<AutumnBillingMeterUsageInput, AutumnBillingMeterUsageResult>
  >,
  AutumnClientEntry<
    ResolvedAutumnClientPath<TInput["reportUsagePath"], "/billing/report-usage">,
    AutumnPostOperation<AutumnBillingReportUsageInput, AutumnBillingReportUsageResult>
  >,
  AutumnClientEntry<
    ResolvedAutumnClientPath<TInput["checkPath"], "/billing/check">,
    AutumnPostOperation<AutumnBillingCheckInput, AutumnBillingCheckResult>
  >,
  AutumnClientEntry<
    ResolvedAutumnClientPath<TInput["checkoutPath"], "/billing/checkout">,
    AutumnPostOperation<AutumnCheckoutInput, AutumnCheckoutResult>
  >,
  AutumnClientEntry<
    ResolvedAutumnClientPath<TInput["portalPath"], "/billing/portal">,
    AutumnPostOperation<AutumnPortalInput, AutumnPortalResult>
  >,
];

export type AutumnClientAPI<TInput extends AutumnClientPathOptions = {}> =
  InferPathInferredClientAPI<AutumnClientEntries<TInput>>;

export type AutumnDefaultClientAPI = InferPathInferredClientAPI<
  AutumnClientEntries<AutumnDefaultClientPaths>
>;

export function createAutumnClientApi(): AutumnDefaultClientAPI;
export function createAutumnClientApi<const TInput extends AutumnClientPathOptions>(
  input: TInput,
): AutumnClientAPI<TInput>;
export function createAutumnClientApi<TInput extends AutumnClientPathOptions>(
  input?: TInput,
): AutumnDefaultClientAPI | AutumnClientAPI<TInput> {
  const productsPath = (input?.productsPath ?? "/billing/products") as ResolvedAutumnClientPath<
    TInput["productsPath"],
    "/billing/products"
  >;
  const statusPath = (input?.statusPath ?? "/billing/status") as ResolvedAutumnClientPath<
    TInput["statusPath"],
    "/billing/status"
  >;
  const currentChargesPath = (input?.currentChargesPath ??
    "/billing/current-charges") as ResolvedAutumnClientPath<
    TInput["currentChargesPath"],
    "/billing/current-charges"
  >;
  const invoicesPath = (input?.invoicesPath ?? "/billing/invoices") as ResolvedAutumnClientPath<
    TInput["invoicesPath"],
    "/billing/invoices"
  >;
  const featuresPath = (input?.featuresPath ?? "/billing/features") as ResolvedAutumnClientPath<
    TInput["featuresPath"],
    "/billing/features"
  >;
  const limitsPath = (input?.limitsPath ?? "/billing/limits") as ResolvedAutumnClientPath<
    TInput["limitsPath"],
    "/billing/limits"
  >;
  const usagePath = (input?.usagePath ?? "/billing/usage") as ResolvedAutumnClientPath<
    TInput["usagePath"],
    "/billing/usage"
  >;
  const meterUsagePath = (input?.meterUsagePath ??
    "/billing/meter-usage") as ResolvedAutumnClientPath<
    TInput["meterUsagePath"],
    "/billing/meter-usage"
  >;
  const reportUsagePath = (input?.reportUsagePath ??
    "/billing/report-usage") as ResolvedAutumnClientPath<
    TInput["reportUsagePath"],
    "/billing/report-usage"
  >;
  const checkPath = (input?.checkPath ?? "/billing/check") as ResolvedAutumnClientPath<
    TInput["checkPath"],
    "/billing/check"
  >;
  const checkoutPath = (input?.checkoutPath ?? "/billing/checkout") as ResolvedAutumnClientPath<
    TInput["checkoutPath"],
    "/billing/checkout"
  >;
  const portalPath = (input?.portalPath ?? "/billing/portal") as ResolvedAutumnClientPath<
    TInput["portalPath"],
    "/billing/portal"
  >;

  return createPathInferredClientApi(
    {
      path: productsPath,
      operation: api.get<AutumnCatalogProduct[]>(productsPath, {
        responseFormat: "json",
      }),
    },
    {
      path: statusPath,
      operation: api.get<AutumnBillingStatusResult>(statusPath, {
        responseFormat: "json",
      }),
    },
    {
      path: currentChargesPath,
      operation: api.get<AutumnBillingCurrentChargesResult>(currentChargesPath, {
        responseFormat: "json",
      }),
    },
    {
      path: invoicesPath,
      operation: api.get<AutumnBillingInvoicesResult>(invoicesPath, {
        responseFormat: "json",
      }),
    },
    {
      path: featuresPath,
      operation: api.get<AutumnBillingFeaturesResult>(featuresPath, {
        responseFormat: "json",
      }),
    },
    {
      path: limitsPath,
      operation: api.get<AutumnBillingLimitsResult>(limitsPath, {
        responseFormat: "json",
      }),
    },
    {
      path: usagePath,
      operation: api.post<AutumnBillingUsageInput, AutumnBillingUsageResult>(usagePath, {
        responseFormat: "json",
      }),
    },
    {
      path: meterUsagePath,
      operation: api.post<AutumnBillingMeterUsageInput, AutumnBillingMeterUsageResult>(
        meterUsagePath,
        {
          responseFormat: "json",
        },
      ),
    },
    {
      path: reportUsagePath,
      operation: api.post<AutumnBillingReportUsageInput, AutumnBillingReportUsageResult>(
        reportUsagePath,
        {
          responseFormat: "json",
        },
      ),
    },
    {
      path: checkPath,
      operation: api.post<AutumnBillingCheckInput, AutumnBillingCheckResult>(checkPath, {
        responseFormat: "json",
      }),
    },
    {
      path: checkoutPath,
      operation: api.post<AutumnCheckoutInput, AutumnCheckoutResult>(checkoutPath, {
        responseFormat: "json",
      }),
    },
    {
      path: portalPath,
      operation: api.post<AutumnPortalInput, AutumnPortalResult>(portalPath, {
        responseFormat: "json",
      }),
    },
  ) as AutumnDefaultClientAPI | AutumnClientAPI<TInput>;
}

export const autumnClient: AutumnDefaultClientAPI = createAutumnClientApi();
