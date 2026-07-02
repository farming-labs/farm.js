import type Stripe from "stripe";
import type { FarmIntegrationHandlerContext } from "@farmjs/core";

export type StripeBillingOwner = {
  kind: "user" | "organization";
  id: string;
  email?: string;
};

export type StripeBillingStatus =
  | "free"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete";

export type StripeBillingEntitlements = Record<string, unknown>;
export type StripeBillingFeatures = Record<string, boolean>;
export type StripeBillingLimits = Record<string, number>;
export type StripeBillingProductKind = "subscription" | "one_time";
export type StripeBillingSeatsMode = "plan_limit" | "subscription_quantity";
export type StripeBillingSeatLimitSource =
  | "plan_limit"
  | "subscription_quantity"
  | "override"
  | "none";
export type StripeBillingUsageProperties = Record<string, string | number | boolean>;
export type StripeBillingMeterAggregation = "sum" | "count" | "last";
export type StripeBillingMeterIngestion = "raw" | "pre_aggregated";
export type StripeBillingMeterState =
  | "ok"
  | "soft_limit_reached"
  | "hard_limit_reached"
  | "blocked_past_due"
  | "subscription_missing_meter_price";
export interface StripeBillingPlanLimitReference {
  planId: string;
  key?: string;
}
export type StripeBillingSoftLimit =
  | "plan_limit"
  | number
  | StripeBillingPlanLimitReference
  | `plans.${string}.limit.${string}`
  | `plans.${string}.limits.${string}`;

export interface StripeBillingSeatsOptions {
  mode?: StripeBillingSeatsMode;
}

export interface StripeBillingMeterGuard {
  softLimit?: StripeBillingSoftLimit;
  hardLimit?: number;
  hardOverage?: number;
  hardLimitByPlan?: Record<string, number>;
  hardOverageByPlan?: Record<string, number>;
  blockOnPastDue?: boolean;
}

export interface StripeBillingMeter {
  aggregation: StripeBillingMeterAggregation;
  ingestion: StripeBillingMeterIngestion;
  window?: "hour" | "day";
  eventName: string;
  unit?: string;
  guard?: StripeBillingMeterGuard;
}

export interface StripeBillingTrialEligibilityInput {
  owner: StripeBillingOwner;
  planId: string;
  productId: string;
  existingSnapshot: StripeBillingSnapshot | null;
  hasUsedTrial: boolean;
}

export interface StripeBillingTrial {
  days: number;
  oncePerOwner?: boolean;
  eligible?(
    input: StripeBillingTrialEligibilityInput,
    tools: StripeBillingHookTools,
  ): Promise<boolean> | boolean;
}

export interface StripeBillingProductStripeOptions {
  priceId?: string;
  seatPriceId?: string;
  meterPriceIds?: Record<string, string>;
  lookupKey?: string;
}

export interface StripeBillingProductPolarOptions {
  productId?: string;
}

export interface StripeBillingPlan {
  public?: boolean;
  features?: StripeBillingFeatures;
  limits?: StripeBillingLimits;
  entitlements?: StripeBillingEntitlements;
  trial?: StripeBillingTrial;
}

export interface StripeBillingProduct {
  public?: boolean;
  name?: string;
  description?: string;
  kind: StripeBillingProductKind;
  planId?: string;
  stripe?: StripeBillingProductStripeOptions;
  polar?: StripeBillingProductPolarOptions;
  priceId?: string;
  seatPriceId?: string;
  meterPriceIds?: Record<string, string>;
  lookupKey?: string;
  currency?: string;
  unitAmount?: number;
  interval?: "day" | "week" | "month" | "year";
  intervalCount?: number;
  quantity?: number;
  seatBilling?: "line_item_quantity" | "included_plus_add_on";
  imageUrl?: string;
  metadata?: Record<string, string>;
}

export interface StripeBillingSnapshot {
  owner: StripeBillingOwner;
  planId: string;
  productId: string | null;
  status: StripeBillingStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  trialUsedAt: Date | null;
  seatQuantity: number | null;
  seatAllowanceOverride: number | null;
  metadata?: Record<string, string>;
}

export interface StripeBillingStorageAdapter {
  getBillingAccount(owner: StripeBillingOwner): Promise<StripeBillingSnapshot | null>;
  getBillingAccountByStripeCustomerId(customerId: string): Promise<StripeBillingSnapshot | null>;
  ensureCustomer(input: {
    owner: StripeBillingOwner;
    stripe: Stripe;
  }): Promise<{ customerId: string }>;
  saveBillingSnapshot(snapshot: StripeBillingSnapshot): Promise<void>;
  clearBillingSnapshot(owner: StripeBillingOwner): Promise<void>;
}

export interface StripeBillingStorageTools {
  getClient(): Promise<unknown | undefined>;
  getOrm(): Promise<unknown>;
}

export interface StripeBillingHookTools {
  ctx: FarmIntegrationHandlerContext;
  stripe: Stripe | null;
  storage: StripeBillingStorageTools;
}

export interface StripeBillingUsageOptions {
  resolve(
    owner: StripeBillingOwner,
    key: string,
    tools: StripeBillingHookTools,
  ): Promise<number | null> | number | null;
}

export interface StripeBillingHooks {
  getBillingAccount?(
    owner: StripeBillingOwner,
    tools: StripeBillingHookTools,
  ): Promise<StripeBillingSnapshot | null>;
  getBillingAccountByStripeCustomerId?(
    customerId: string,
    tools: StripeBillingHookTools,
  ): Promise<StripeBillingSnapshot | null>;
  ensureCustomer?(
    owner: StripeBillingOwner,
    tools: StripeBillingHookTools,
  ): Promise<{ customerId: string }>;
  saveBillingSnapshot?(
    snapshot: StripeBillingSnapshot,
    tools: StripeBillingHookTools,
  ): Promise<void>;
  clearBillingSnapshot?(owner: StripeBillingOwner, tools: StripeBillingHookTools): Promise<void>;
  onCheckoutCreated?(
    payload: {
      owner: StripeBillingOwner;
      planId: string;
      productId: string;
      sessionId: string;
      redirectTo: string;
      trialApplied: boolean;
      trialDays: number | null;
    },
    tools: StripeBillingHookTools,
  ): Promise<void> | void;
  onCheckoutCompleted?(
    snapshot: StripeBillingSnapshot & {
      sessionId: string;
    },
    tools: StripeBillingHookTools,
  ): Promise<void> | void;
  onTrialStarted?(
    snapshot: StripeBillingSnapshot & {
      trialDays: number;
    },
    tools: StripeBillingHookTools,
  ): Promise<void> | void;
  onTrialWillEnd?(
    snapshot: StripeBillingSnapshot,
    tools: StripeBillingHookTools,
  ): Promise<void> | void;
  onTrialEnded?(
    snapshot: StripeBillingSnapshot,
    tools: StripeBillingHookTools,
  ): Promise<void> | void;
  onTrialExpired?(
    snapshot: StripeBillingSnapshot,
    tools: StripeBillingHookTools,
  ): Promise<void> | void;
  onBillingSync?(
    snapshot: StripeBillingSnapshot,
    tools: StripeBillingHookTools,
  ): Promise<void> | void;
  onPaymentSucceeded?(
    snapshot: StripeBillingSnapshot,
    tools: StripeBillingHookTools,
  ): Promise<void> | void;
  onPaymentFailed?(
    snapshot: StripeBillingSnapshot,
    tools: StripeBillingHookTools,
  ): Promise<void> | void;
  onUsageReported?(
    payload: {
      owner: StripeBillingOwner;
      key: string;
      quantity: number;
      idempotencyKey: string;
      occurredAt: string;
      stripeCustomerId: string;
      stripeEventName: string;
      stripeEventIdentifier: string;
      properties?: StripeBillingUsageProperties;
    },
    tools: StripeBillingHookTools,
  ): Promise<void> | void;
}

export interface StripeBillingOptions {
  resolveOwner(
    context: FarmIntegrationHandlerContext,
    tools?: StripeBillingHookTools,
  ): Promise<StripeBillingOwner | null> | StripeBillingOwner | null;
  plans?: Record<string, StripeBillingPlan>;
  products?: Record<string, StripeBillingProduct>;
  seats?: StripeBillingSeatsOptions;
  usage?: StripeBillingUsageOptions;
  meters?: Record<string, StripeBillingMeter>;
  storage?: StripeBillingStorageAdapter;
  hooks?: StripeBillingHooks;
}

type PrismaDelegate = {
  findFirst(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
  create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
};

type PrismaStorageOptions = {
  prisma: unknown;
  model?: string;
};

type StripeOrmModelClient = {
  findFirst(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
  create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null>;
};

type StripeOrmStorageOptions = {
  orm: unknown | Promise<unknown> | (() => unknown | Promise<unknown>);
  model?: string;
};

type StripeBillingSnapshotRecord = {
  id?: string;
  ownerId: string;
  ownerKind: StripeBillingOwner["kind"];
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  planId: string;
  productId: string | null;
  status: StripeBillingStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  trialUsedAt: Date | null;
  seatQuantity: number | null;
  seatAllowanceOverride: number | null;
  createdAt?: Date;
  updatedAt: Date;
};

function requireOrmModel(options: { orm: unknown; model: string }): StripeOrmModelClient {
  const modelClient = (options.orm as Record<string, unknown> | null)?.[options.model];

  if (!modelClient || typeof modelClient !== "object") {
    throw new Error(`Stripe ORM storage adapter could not find orm.${options.model}.`);
  }

  const candidate = modelClient as Partial<StripeOrmModelClient>;
  if (
    typeof candidate.findFirst !== "function" ||
    typeof candidate.create !== "function" ||
    typeof candidate.update !== "function"
  ) {
    throw new Error(
      `Stripe ORM storage adapter expected orm.${options.model} to expose findFirst, create, and update.`,
    );
  }

  return candidate as StripeOrmModelClient;
}

function createBillingSnapshotData(
  snapshot: StripeBillingSnapshot,
): Omit<StripeBillingSnapshotRecord, "id" | "createdAt"> {
  return {
    ownerId: snapshot.owner.id,
    ownerKind: snapshot.owner.kind,
    stripeCustomerId: snapshot.stripeCustomerId,
    stripeSubscriptionId: snapshot.stripeSubscriptionId,
    planId: snapshot.planId,
    productId: snapshot.productId,
    status: snapshot.status,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    trialEndsAt: snapshot.trialEndsAt,
    trialUsedAt: snapshot.trialUsedAt,
    seatQuantity: snapshot.seatQuantity,
    seatAllowanceOverride: snapshot.seatAllowanceOverride,
    updatedAt: new Date(),
  };
}

function isUnknownPrismaFieldError(error: unknown, field: string): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const normalizedMessage = error.message.replace(/\s+/g, " ");
  return normalizedMessage.includes(`Unknown argument \`${field}\``);
}

async function withPrismaDataFieldsFallback<T>(
  operation: (data: Record<string, unknown>) => Promise<T>,
  data: Record<string, unknown>,
  fallbackFields: readonly string[],
): Promise<T> {
  let nextData = { ...data };

  for (const field of fallbackFields) {
    try {
      return await operation(nextData);
    } catch (error) {
      if (!isUnknownPrismaFieldError(error, field)) {
        throw error;
      }

      delete nextData[field];
    }
  }

  return await operation(nextData);
}

function createBillingRecordId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return randomUuid;
  }

  return `farm-billing-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getRecordValue(record: Record<string, unknown>, ...keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function getNullableString(
  record: Record<string, unknown>,
  ...keys: readonly string[]
): string | null {
  const value = getRecordValue(record, ...keys);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getNullableInteger(
  record: Record<string, unknown>,
  ...keys: readonly string[]
): number | null {
  const value = getRecordValue(record, ...keys);
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return null;
}

function getBooleanValue(record: Record<string, unknown>, ...keys: readonly string[]): boolean {
  const value = getRecordValue(record, ...keys);
  if (typeof value === "number") {
    return value !== 0;
  }

  return Boolean(value);
}

function toSnapshot(record: Record<string, unknown>): StripeBillingSnapshot {
  return {
    owner: {
      kind:
        getRecordValue(record, "ownerKind", "owner_kind") === "organization"
          ? "organization"
          : "user",
      id: String(getRecordValue(record, "ownerId", "owner_id") ?? ""),
    },
    planId: String(getRecordValue(record, "planId", "plan_id") ?? "free"),
    productId: getNullableString(record, "productId", "product_id"),
    status: normalizeStatus(getRecordValue(record, "status")),
    stripeCustomerId: getNullableString(record, "stripeCustomerId", "stripe_customer_id"),
    stripeSubscriptionId: getNullableString(
      record,
      "stripeSubscriptionId",
      "stripe_subscription_id",
    ),
    currentPeriodEnd:
      getRecordValue(record, "currentPeriodEnd", "current_period_end") instanceof Date
        ? (getRecordValue(record, "currentPeriodEnd", "current_period_end") as Date)
        : typeof getRecordValue(record, "currentPeriodEnd", "current_period_end") === "string"
          ? new Date(String(getRecordValue(record, "currentPeriodEnd", "current_period_end")))
          : null,
    cancelAtPeriodEnd: getBooleanValue(record, "cancelAtPeriodEnd", "cancel_at_period_end"),
    trialEndsAt:
      getRecordValue(record, "trialEndsAt", "trial_ends_at") instanceof Date
        ? (getRecordValue(record, "trialEndsAt", "trial_ends_at") as Date)
        : typeof getRecordValue(record, "trialEndsAt", "trial_ends_at") === "string"
          ? new Date(String(getRecordValue(record, "trialEndsAt", "trial_ends_at")))
          : null,
    trialUsedAt:
      getRecordValue(record, "trialUsedAt", "trial_used_at") instanceof Date
        ? (getRecordValue(record, "trialUsedAt", "trial_used_at") as Date)
        : typeof getRecordValue(record, "trialUsedAt", "trial_used_at") === "string"
          ? new Date(String(getRecordValue(record, "trialUsedAt", "trial_used_at")))
          : null,
    seatQuantity: getNullableInteger(record, "seatQuantity", "seat_quantity"),
    seatAllowanceOverride: getNullableInteger(
      record,
      "seatAllowanceOverride",
      "seat_allowance_override",
    ),
  };
}

function normalizeStatus(value: unknown): StripeBillingStatus {
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

function requirePrismaDelegate(options: PrismaStorageOptions): PrismaDelegate {
  const modelName = options.model ?? "billingBillingAccount";
  const delegate = (options.prisma as Record<string, unknown> | null)?.[modelName];

  if (!delegate || typeof delegate !== "object") {
    throw new Error(`Stripe Prisma storage adapter could not find prisma.${modelName}.`);
  }

  return delegate as PrismaDelegate;
}

export function prismaStorageAdapter(options: PrismaStorageOptions): StripeBillingStorageAdapter {
  const delegate = requirePrismaDelegate(options);

  async function findByOwner(owner: StripeBillingOwner) {
    return await delegate.findFirst({
      where: {
        ownerKind: owner.kind,
        ownerId: owner.id,
      },
    });
  }

  async function findByCustomerId(customerId: string) {
    return await delegate.findFirst({
      where: {
        stripeCustomerId: customerId,
      },
    });
  }

  return {
    async getBillingAccount(owner) {
      const record = await findByOwner(owner);
      return record ? toSnapshot(record) : null;
    },

    async getBillingAccountByStripeCustomerId(customerId) {
      const record = await findByCustomerId(customerId);
      return record ? toSnapshot(record) : null;
    },

    async ensureCustomer({ owner, stripe }) {
      const existing = await findByOwner(owner);
      if (typeof existing?.stripeCustomerId === "string" && existing.stripeCustomerId) {
        return {
          customerId: existing.stripeCustomerId,
        };
      }

      const customer = await stripe.customers.create({
        email: owner.email,
        metadata: {
          ownerId: owner.id,
          ownerKind: owner.kind,
        },
      });

      if (existing?.id) {
        await delegate.update({
          where: { id: existing.id },
          data: {
            stripeCustomerId: customer.id,
          },
        });
      } else {
        await withPrismaDataFieldsFallback(
          (data) =>
            delegate.create({
              data,
            }),
          {
            ownerId: owner.id,
            ownerKind: owner.kind,
            stripeCustomerId: customer.id,
            planId: "free",
            productId: null,
            status: "free",
            cancelAtPeriodEnd: false,
            trialEndsAt: null,
            trialUsedAt: null,
            seatQuantity: null,
            seatAllowanceOverride: null,
          },
          ["seatAllowanceOverride", "seatQuantity", "trialUsedAt", "trialEndsAt", "productId"],
        );
      }

      return {
        customerId: customer.id,
      };
    },

    async saveBillingSnapshot(snapshot) {
      const existing = await findByOwner(snapshot.owner);

      const data = {
        ownerId: snapshot.owner.id,
        ownerKind: snapshot.owner.kind,
        stripeCustomerId: snapshot.stripeCustomerId,
        stripeSubscriptionId: snapshot.stripeSubscriptionId,
        planId: snapshot.planId,
        productId: snapshot.productId,
        status: snapshot.status,
        currentPeriodEnd: snapshot.currentPeriodEnd,
        cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
        trialEndsAt: snapshot.trialEndsAt,
        trialUsedAt: snapshot.trialUsedAt,
        seatQuantity: snapshot.seatQuantity,
        seatAllowanceOverride: snapshot.seatAllowanceOverride,
      };

      if (existing?.id) {
        await withPrismaDataFieldsFallback(
          (retryData) =>
            delegate.update({
              where: { id: existing.id },
              data: retryData,
            }),
          data,
          ["seatAllowanceOverride", "seatQuantity", "trialUsedAt", "trialEndsAt", "productId"],
        );
        return;
      }

      await withPrismaDataFieldsFallback(
        (retryData) =>
          delegate.create({
            data: retryData,
          }),
        data,
        ["seatAllowanceOverride", "seatQuantity", "trialUsedAt", "trialEndsAt", "productId"],
      );
    },

    async clearBillingSnapshot(owner) {
      const existing = await findByOwner(owner);
      if (!existing?.id) {
        return;
      }

      await withPrismaDataFieldsFallback(
        (data) =>
          delegate.update({
            where: { id: existing.id },
            data,
          }),
        {
          planId: "free",
          productId: null,
          status: "free",
          stripeSubscriptionId: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          trialEndsAt: null,
          seatQuantity: null,
        },
        ["seatQuantity", "trialEndsAt", "productId"],
      );
    },
  };
}

export function ormStorageAdapter(options: StripeOrmStorageOptions): StripeBillingStorageAdapter {
  const modelName = options.model ?? "billingAccount";
  let modelPromise: Promise<StripeOrmModelClient> | undefined;

  async function getModel(): Promise<StripeOrmModelClient> {
    modelPromise ??= Promise.resolve(
      typeof options.orm === "function" ? options.orm() : options.orm,
    ).then((orm) =>
      requireOrmModel({
        orm,
        model: modelName,
      }),
    );

    return modelPromise;
  }

  async function findByOwner(owner: StripeBillingOwner) {
    const model = await getModel();
    return await model.findFirst({
      where: {
        ownerKind: owner.kind,
        ownerId: owner.id,
      },
    });
  }

  async function findByCustomerId(customerId: string) {
    const model = await getModel();
    return await model.findFirst({
      where: {
        stripeCustomerId: customerId,
      },
    });
  }

  return {
    async getBillingAccount(owner) {
      const record = await findByOwner(owner);
      return record ? toSnapshot(record) : null;
    },

    async getBillingAccountByStripeCustomerId(customerId) {
      const record = await findByCustomerId(customerId);
      return record ? toSnapshot(record) : null;
    },

    async ensureCustomer({ owner, stripe }) {
      const existing = await findByOwner(owner);
      const existingCustomerId =
        existing && getNullableString(existing, "stripeCustomerId", "stripe_customer_id");
      if (existingCustomerId) {
        return {
          customerId: existingCustomerId,
        };
      }

      const customer = await stripe.customers.create({
        email: owner.email,
        metadata: {
          ownerId: owner.id,
          ownerKind: owner.kind,
        },
      });

      const model = await getModel();
      if (existing?.id) {
        await model.update({
          where: {
            id: existing.id,
          },
          data: {
            stripeCustomerId: customer.id,
            updatedAt: new Date(),
          },
        });
      } else {
        await model.create({
          data: {
            id: createBillingRecordId(),
            ownerId: owner.id,
            ownerKind: owner.kind,
            stripeCustomerId: customer.id,
            stripeSubscriptionId: null,
            planId: "free",
            productId: null,
            status: "free",
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            trialEndsAt: null,
            trialUsedAt: null,
            seatQuantity: null,
            seatAllowanceOverride: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }

      return {
        customerId: customer.id,
      };
    },

    async saveBillingSnapshot(snapshot) {
      const existing = await findByOwner(snapshot.owner);
      const data = createBillingSnapshotData(snapshot);
      const model = await getModel();

      if (existing?.id) {
        await model.update({
          where: {
            id: existing.id,
          },
          data,
        });
        return;
      }

      await model.create({
        data: {
          id: createBillingRecordId(),
          ...data,
          createdAt: new Date(),
        },
      });
    },

    async clearBillingSnapshot(owner) {
      const existing = await findByOwner(owner);
      if (!existing?.id) {
        return;
      }

      const model = await getModel();
      await model.update({
        where: {
          id: existing.id,
        },
        data: {
          planId: "free",
          productId: null,
          status: "free",
          stripeSubscriptionId: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          trialEndsAt: null,
          seatQuantity: null,
          updatedAt: new Date(),
        },
      });
    },
  };
}

type SqliteDatabase = {
  prepare(sql: string): {
    get(...params: readonly unknown[]): Record<string, unknown> | undefined;
    run(...params: readonly unknown[]): { changes: number };
    all?(...params: readonly unknown[]): Record<string, unknown>[];
  };
};

type SqliteStorageOptions = {
  db: SqliteDatabase;
  tableName?: string;
};

export function sqliteStorageAdapter(options: SqliteStorageOptions): StripeBillingStorageAdapter {
  const tableName = options.tableName ?? "billing_account";
  const db = options.db;
  const tableInfoStatement = db.prepare(`PRAGMA table_info("${tableName}")`);
  const supportedColumns =
    typeof tableInfoStatement.all === "function"
      ? new Set(tableInfoStatement.all().map((row) => String(row.name ?? "")))
      : null;
  const hasColumn = (columnName: string) =>
    supportedColumns ? supportedColumns.has(columnName) : true;
  const supportsTrialColumns = hasColumn("trial_ends_at") && hasColumn("trial_used_at");
  const supportsSeatQuantityColumn = hasColumn("seat_quantity");
  const supportsSeatAllowanceOverrideColumn = hasColumn("seat_allowance_override");

  const selectByOwner = db.prepare(
    `SELECT * FROM "${tableName}" WHERE owner_kind = ? AND owner_id = ? LIMIT 1`,
  );
  const selectByCustomerId = db.prepare(
    `SELECT * FROM "${tableName}" WHERE stripe_customer_id = ? LIMIT 1`,
  );
  const insertRecord = db.prepare(
    `INSERT INTO "${tableName}" (
      id,
      owner_id,
      owner_kind,
      stripe_customer_id,
      stripe_subscription_id,
      plan_id,
      product_id,
      status,
      current_period_end,
      cancel_at_period_end,
      ${supportsTrialColumns ? "trial_ends_at," : ""}
      ${supportsTrialColumns ? "trial_used_at," : ""}
      ${supportsSeatQuantityColumn ? "seat_quantity," : ""}
      ${supportsSeatAllowanceOverrideColumn ? "seat_allowance_override," : ""}
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${supportsTrialColumns ? "?, ?, " : ""}${
      supportsSeatQuantityColumn ? "?, " : ""
    }${supportsSeatAllowanceOverrideColumn ? "?, " : ""}CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  const updateByOwner = db.prepare(
    `UPDATE "${tableName}" SET
      stripe_customer_id = ?,
      stripe_subscription_id = ?,
      plan_id = ?,
      product_id = ?,
      status = ?,
      current_period_end = ?,
      cancel_at_period_end = ?,
      ${supportsTrialColumns ? "trial_ends_at = ?, trial_used_at = ?," : ""}
      ${supportsSeatQuantityColumn ? "seat_quantity = ?," : ""}
      ${supportsSeatAllowanceOverrideColumn ? "seat_allowance_override = ?," : ""}
      updated_at = CURRENT_TIMESTAMP
    WHERE owner_kind = ? AND owner_id = ?`,
  );
  const clearByOwner = db.prepare(
    `UPDATE "${tableName}" SET
      plan_id = 'free',
      product_id = NULL,
      status = 'free',
      stripe_subscription_id = NULL,
      current_period_end = NULL,
      cancel_at_period_end = 0,
      ${supportsTrialColumns ? "trial_ends_at = NULL," : ""}
      ${supportsSeatQuantityColumn ? "seat_quantity = NULL," : ""}
      updated_at = CURRENT_TIMESTAMP
    WHERE owner_kind = ? AND owner_id = ?`,
  );
  const updateCustomerByOwner = db.prepare(
    `UPDATE "${tableName}" SET
      stripe_customer_id = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE owner_kind = ? AND owner_id = ?`,
  );

  function readByOwner(owner: StripeBillingOwner) {
    return selectByOwner.get(owner.kind, owner.id) ?? null;
  }

  return {
    async getBillingAccount(owner) {
      const record = readByOwner(owner);
      return record ? toSnapshot(record) : null;
    },

    async getBillingAccountByStripeCustomerId(customerId) {
      const record = selectByCustomerId.get(customerId) ?? null;
      return record ? toSnapshot(record) : null;
    },

    async ensureCustomer({ owner, stripe }) {
      const existing = readByOwner(owner);
      const existingCustomerId =
        existing && getNullableString(existing, "stripeCustomerId", "stripe_customer_id");
      if (existingCustomerId) {
        return {
          customerId: existingCustomerId,
        };
      }

      const customer = await stripe.customers.create({
        email: owner.email,
        metadata: {
          ownerId: owner.id,
          ownerKind: owner.kind,
        },
      });

      if (existing) {
        updateCustomerByOwner.run(customer.id, owner.kind, owner.id);
      } else {
        insertRecord.run(
          createBillingRecordId(),
          owner.id,
          owner.kind,
          customer.id,
          null,
          "free",
          null,
          "free",
          null,
          0,
          ...(supportsTrialColumns ? [null, null] : []),
          ...(supportsSeatQuantityColumn ? [null] : []),
          ...(supportsSeatAllowanceOverrideColumn ? [null] : []),
        );
      }

      return {
        customerId: customer.id,
      };
    },

    async saveBillingSnapshot(snapshot) {
      const existing = readByOwner(snapshot.owner);
      const periodEnd = snapshot.currentPeriodEnd ? snapshot.currentPeriodEnd.toISOString() : null;
      const trialEndsAt = snapshot.trialEndsAt ? snapshot.trialEndsAt.toISOString() : null;
      const trialUsedAt = snapshot.trialUsedAt ? snapshot.trialUsedAt.toISOString() : null;
      const seatQuantity = snapshot.seatQuantity;
      const seatAllowanceOverride = snapshot.seatAllowanceOverride;

      if (existing) {
        updateByOwner.run(
          snapshot.stripeCustomerId,
          snapshot.stripeSubscriptionId,
          snapshot.planId,
          snapshot.productId,
          snapshot.status,
          periodEnd,
          snapshot.cancelAtPeriodEnd ? 1 : 0,
          ...(supportsTrialColumns ? [trialEndsAt, trialUsedAt] : []),
          ...(supportsSeatQuantityColumn ? [seatQuantity] : []),
          ...(supportsSeatAllowanceOverrideColumn ? [seatAllowanceOverride] : []),
          snapshot.owner.kind,
          snapshot.owner.id,
        );
        return;
      }

      insertRecord.run(
        createBillingRecordId(),
        snapshot.owner.id,
        snapshot.owner.kind,
        snapshot.stripeCustomerId,
        snapshot.stripeSubscriptionId,
        snapshot.planId,
        snapshot.productId,
        snapshot.status,
        periodEnd,
        snapshot.cancelAtPeriodEnd ? 1 : 0,
        ...(supportsTrialColumns ? [trialEndsAt, trialUsedAt] : []),
        ...(supportsSeatQuantityColumn ? [seatQuantity] : []),
        ...(supportsSeatAllowanceOverrideColumn ? [seatAllowanceOverride] : []),
      );
    },

    async clearBillingSnapshot(owner) {
      const existing = readByOwner(owner);
      if (!existing) {
        return;
      }

      clearByOwner.run(owner.kind, owner.id);
    },
  };
}

type DrizzleStorageOptions = {
  db: {
    select(): {
      from(table: unknown): {
        where(condition: unknown): {
          limit(count: number): Promise<Record<string, unknown>[]> | Record<string, unknown>[];
        };
      };
    };
    insert(table: unknown): {
      values(input: Record<string, unknown>): Promise<unknown> | unknown;
    };
    update(table: unknown): {
      set(input: Record<string, unknown>): {
        where(condition: unknown): Promise<unknown> | unknown;
      };
    };
  };
  table: Record<string, unknown>;
  eq(left: unknown, right: unknown): unknown;
  and(...conditions: unknown[]): unknown;
};

function drizzleHasColumn(table: Record<string, unknown>, key: string): boolean {
  return key in table;
}

export function drizzleStorageAdapter(options: DrizzleStorageOptions): StripeBillingStorageAdapter {
  const { db, table, eq, and } = options;

  async function firstByOwner(owner: StripeBillingOwner) {
    const rows = await db
      .select()
      .from(table)
      .where(and(eq(table.ownerKind, owner.kind), eq(table.ownerId, owner.id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async function firstByCustomerId(customerId: string) {
    const rows = await db
      .select()
      .from(table)
      .where(eq(table.stripeCustomerId, customerId))
      .limit(1);
    return rows[0] ?? null;
  }

  return {
    async getBillingAccount(owner) {
      const record = await firstByOwner(owner);
      return record ? toSnapshot(record) : null;
    },

    async getBillingAccountByStripeCustomerId(customerId) {
      const record = await firstByCustomerId(customerId);
      return record ? toSnapshot(record) : null;
    },

    async ensureCustomer({ owner, stripe }) {
      const existing = await firstByOwner(owner);
      if (typeof existing?.stripeCustomerId === "string" && existing.stripeCustomerId) {
        return {
          customerId: existing.stripeCustomerId,
        };
      }

      const customer = await stripe.customers.create({
        email: owner.email,
        metadata: {
          ownerId: owner.id,
          ownerKind: owner.kind,
        },
      });

      if (existing?.id != null) {
        await db
          .update(table)
          .set({
            stripeCustomerId: customer.id,
            updatedAt: new Date(),
          })
          .where(eq(table.id, existing.id));
      } else {
        await db.insert(table).values({
          ownerId: owner.id,
          ownerKind: owner.kind,
          stripeCustomerId: customer.id,
          planId: "free",
          productId: null,
          status: "free",
          cancelAtPeriodEnd: false,
          ...(drizzleHasColumn(table, "trialEndsAt") ? { trialEndsAt: null } : {}),
          ...(drizzleHasColumn(table, "trialUsedAt") ? { trialUsedAt: null } : {}),
          ...(drizzleHasColumn(table, "seatQuantity") ? { seatQuantity: null } : {}),
          ...(drizzleHasColumn(table, "seatAllowanceOverride")
            ? { seatAllowanceOverride: null }
            : {}),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      return {
        customerId: customer.id,
      };
    },

    async saveBillingSnapshot(snapshot) {
      const existing = await firstByOwner(snapshot.owner);
      const data = {
        ownerId: snapshot.owner.id,
        ownerKind: snapshot.owner.kind,
        stripeCustomerId: snapshot.stripeCustomerId,
        stripeSubscriptionId: snapshot.stripeSubscriptionId,
        planId: snapshot.planId,
        productId: snapshot.productId,
        status: snapshot.status,
        currentPeriodEnd: snapshot.currentPeriodEnd,
        cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
        ...(drizzleHasColumn(table, "trialEndsAt") ? { trialEndsAt: snapshot.trialEndsAt } : {}),
        ...(drizzleHasColumn(table, "trialUsedAt") ? { trialUsedAt: snapshot.trialUsedAt } : {}),
        ...(drizzleHasColumn(table, "seatQuantity") ? { seatQuantity: snapshot.seatQuantity } : {}),
        ...(drizzleHasColumn(table, "seatAllowanceOverride")
          ? { seatAllowanceOverride: snapshot.seatAllowanceOverride }
          : {}),
        updatedAt: new Date(),
      };

      if (existing?.id != null) {
        await db.update(table).set(data).where(eq(table.id, existing.id));
        return;
      }

      await db.insert(table).values({
        ...data,
        createdAt: new Date(),
      });
    },

    async clearBillingSnapshot(owner) {
      const existing = await firstByOwner(owner);
      if (existing?.id == null) {
        return;
      }

      await db
        .update(table)
        .set({
          planId: "free",
          productId: null,
          status: "free",
          stripeSubscriptionId: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          ...(drizzleHasColumn(table, "trialEndsAt") ? { trialEndsAt: null } : {}),
          ...(drizzleHasColumn(table, "seatQuantity") ? { seatQuantity: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(table.id, existing.id));
    },
  };
}
