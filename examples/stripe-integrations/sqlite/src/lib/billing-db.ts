import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type ExampleBillingOwner = {
  kind: "user" | "organization";
  id: string;
  email?: string;
};

export type ExampleBillingStatus =
  | "free"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete";

export type ExampleBillingSnapshot = {
  owner: ExampleBillingOwner;
  planId: string;
  productId: string | null;
  status: ExampleBillingStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  trialUsedAt: Date | null;
  seatQuantity: number | null;
  seatAllowanceOverride: number | null;
  metadata?: Record<string, string>;
};

type BillingAccountRow = {
  id: string | null;
  owner_id: string;
  owner_kind: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan_id: string;
  product_id: string | null;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: number;
  trial_ends_at: string | null;
  trial_used_at: string | null;
  seat_quantity: number | null;
  seat_allowance_override: number | null;
};

const database = new Database(path.join(process.cwd(), "billing.sqlite"));
const generatedSchemaPath = path.join(
  process.cwd(),
  "farm-integrations.generated.sqlite.sql",
);

database.exec(fs.readFileSync(generatedSchemaPath, "utf8"));
database.exec(`
  CREATE TABLE IF NOT EXISTS "billing_hook_event" (
    "id" TEXT PRIMARY KEY,
    "hook_name" TEXT NOT NULL,
    "owner_id" TEXT,
    "owner_kind" TEXT,
    "plan_id" TEXT,
    "product_id" TEXT,
    "status" TEXT,
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "session_id" TEXT,
    "payload" TEXT NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
try {
  database.exec(`ALTER TABLE "billing_account" ADD COLUMN "product_id" TEXT;`);
} catch {
  // Existing example DBs may already include the column.
}
try {
  database.exec(`ALTER TABLE "billing_account" ADD COLUMN "trial_ends_at" TEXT;`);
} catch {
  // Existing example DBs may already include the column.
}
try {
  database.exec(`ALTER TABLE "billing_account" ADD COLUMN "trial_used_at" TEXT;`);
} catch {
  // Existing example DBs may already include the column.
}
try {
  database.exec(`ALTER TABLE "billing_account" ADD COLUMN "seat_quantity" INTEGER;`);
} catch {
  // Existing example DBs may already include the column.
}
try {
  database.exec(`ALTER TABLE "billing_account" ADD COLUMN "seat_allowance_override" INTEGER;`);
} catch {
  // Existing example DBs may already include the column.
}
try {
  database.exec(`ALTER TABLE "billing_hook_event" ADD COLUMN "product_id" TEXT;`);
} catch {
  // Existing example DBs may already include the column.
}

export const billingDatabase = database;

const selectBillingAccountByOwner = database.prepare(
  `SELECT * FROM "billing_account" WHERE owner_kind = ? AND owner_id = ? LIMIT 1`,
);
const selectBillingAccountByCustomerId = database.prepare(
  `SELECT * FROM "billing_account" WHERE stripe_customer_id = ? LIMIT 1`,
);
const insertBillingAccount = database.prepare(
  `INSERT INTO "billing_account" (
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
    trial_ends_at,
    trial_used_at,
    seat_quantity,
    seat_allowance_override,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
);
const updateBillingAccountByOwner = database.prepare(
  `UPDATE "billing_account" SET
    stripe_customer_id = ?,
    stripe_subscription_id = ?,
    plan_id = ?,
    product_id = ?,
    status = ?,
    current_period_end = ?,
    cancel_at_period_end = ?,
    trial_ends_at = ?,
    trial_used_at = ?,
    seat_quantity = ?,
    seat_allowance_override = ?,
    updated_at = CURRENT_TIMESTAMP
  WHERE owner_kind = ? AND owner_id = ?`,
);
const updateBillingAccountCustomerByOwner = database.prepare(
  `UPDATE "billing_account" SET
    stripe_customer_id = ?,
    updated_at = CURRENT_TIMESTAMP
  WHERE owner_kind = ? AND owner_id = ?`,
);
const clearBillingAccountByOwner = database.prepare(
  `UPDATE "billing_account" SET
    plan_id = 'free',
    product_id = NULL,
    status = 'free',
    stripe_subscription_id = NULL,
    current_period_end = NULL,
    cancel_at_period_end = 0,
    trial_ends_at = NULL,
    trial_used_at = NULL,
    seat_quantity = NULL,
    seat_allowance_override = NULL,
    updated_at = CURRENT_TIMESTAMP
  WHERE owner_kind = ? AND owner_id = ?`,
);
const insertBillingHookEvent = database.prepare(
  `INSERT INTO "billing_hook_event" (
    id,
    hook_name,
    owner_id,
    owner_kind,
    plan_id,
    product_id,
    status,
    stripe_customer_id,
    stripe_subscription_id,
    session_id,
    payload
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

function createRecordId() {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return randomUuid;
  }

  return `sqlite-billing-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeStatus(value: string | null | undefined): ExampleBillingStatus {
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

function toSnapshot(row: BillingAccountRow): ExampleBillingSnapshot {
  return {
    owner: {
      kind: row.owner_kind === "organization" ? "organization" : "user",
      id: row.owner_id,
    },
    planId: row.plan_id ?? "free",
    productId: row.product_id ?? null,
    status: normalizeStatus(row.status),
    stripeCustomerId: row.stripe_customer_id ?? null,
    stripeSubscriptionId: row.stripe_subscription_id ?? null,
    currentPeriodEnd: row.current_period_end
      ? new Date(row.current_period_end)
      : null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at) : null,
    trialUsedAt: row.trial_used_at ? new Date(row.trial_used_at) : null,
    seatQuantity: row.seat_quantity ?? null,
    seatAllowanceOverride: row.seat_allowance_override ?? null,
  };
}

function getBillingRowByOwner(owner: ExampleBillingOwner): BillingAccountRow | null {
  return (selectBillingAccountByOwner.get(owner.kind, owner.id) as BillingAccountRow | undefined) ?? null;
}

function getBillingRowByCustomerId(customerId: string): BillingAccountRow | null {
  return (
    selectBillingAccountByCustomerId.get(customerId) as BillingAccountRow | undefined
  ) ?? null;
}

export function getBillingSnapshotByOwner(
  owner: ExampleBillingOwner,
): ExampleBillingSnapshot | null {
  const row = getBillingRowByOwner(owner);
  return row ? toSnapshot(row) : null;
}

export function getBillingSnapshotByCustomerId(
  customerId: string,
): ExampleBillingSnapshot | null {
  const row = getBillingRowByCustomerId(customerId);
  return row ? toSnapshot(row) : null;
}

export function persistBillingSnapshot(snapshot: ExampleBillingSnapshot): void {
  const existing = getBillingRowByOwner(snapshot.owner);
  const currentPeriodEnd = snapshot.currentPeriodEnd
    ? snapshot.currentPeriodEnd.toISOString()
    : null;
  const trialEndsAt = snapshot.trialEndsAt ? snapshot.trialEndsAt.toISOString() : null;
  const trialUsedAt = snapshot.trialUsedAt ? snapshot.trialUsedAt.toISOString() : null;

  if (existing) {
    updateBillingAccountByOwner.run(
      snapshot.stripeCustomerId,
      snapshot.stripeSubscriptionId,
      snapshot.planId,
      snapshot.productId,
      snapshot.status,
      currentPeriodEnd,
      snapshot.cancelAtPeriodEnd ? 1 : 0,
      trialEndsAt,
      trialUsedAt,
      snapshot.seatQuantity,
      snapshot.seatAllowanceOverride,
      snapshot.owner.kind,
      snapshot.owner.id,
    );
    return;
  }

  insertBillingAccount.run(
    createRecordId(),
    snapshot.owner.id,
    snapshot.owner.kind,
    snapshot.stripeCustomerId,
    snapshot.stripeSubscriptionId,
    snapshot.planId,
    snapshot.productId,
    snapshot.status,
    currentPeriodEnd,
    snapshot.cancelAtPeriodEnd ? 1 : 0,
    trialEndsAt,
    trialUsedAt,
    snapshot.seatQuantity,
    snapshot.seatAllowanceOverride,
  );
}

export function persistStripeCustomerLink(
  owner: ExampleBillingOwner,
  customerId: string,
): void {
  const existing = getBillingRowByOwner(owner);
  if (existing) {
    updateBillingAccountCustomerByOwner.run(customerId, owner.kind, owner.id);
    return;
  }

  insertBillingAccount.run(
    createRecordId(),
    owner.id,
    owner.kind,
    customerId,
    null,
    "free",
    null,
    "free",
    null,
    0,
    null,
    null,
    null,
    null,
  );
}

export function resetBillingSnapshot(owner: ExampleBillingOwner): void {
  clearBillingAccountByOwner.run(owner.kind, owner.id);
}

export function recordBillingHookEvent(
  hookName: string,
  payload: Record<string, unknown>,
): void {
  const owner = (payload.owner ??
    null) as { id?: string; kind?: "user" | "organization" } | null;

  insertBillingHookEvent.run(
    createRecordId(),
    hookName,
    owner?.id ?? null,
    owner?.kind ?? null,
    typeof payload.planId === "string" ? payload.planId : null,
    typeof payload.productId === "string" ? payload.productId : null,
    typeof payload.status === "string" ? payload.status : null,
    typeof payload.stripeCustomerId === "string" ? payload.stripeCustomerId : null,
    typeof payload.stripeSubscriptionId === "string" ? payload.stripeSubscriptionId : null,
    typeof payload.sessionId === "string" ? payload.sessionId : null,
    JSON.stringify(payload),
  );
}
