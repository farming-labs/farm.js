import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

async function ensureColumn(
  tableName: string,
  columnName: string,
  columnDefinition: string,
) {
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("${tableName}")`,
  );

  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${tableName}" ADD COLUMN ${columnDefinition}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("duplicate column name")) {
      throw error;
    }
  }
}

await prisma.$executeRawUnsafe(`
  CREATE TABLE IF NOT EXISTS "billing_account" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "owner_id" TEXT NOT NULL,
    "owner_kind" TEXT NOT NULL DEFAULT 'user',
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "plan_id" TEXT NOT NULL DEFAULT 'free',
    "product_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'free',
    "current_period_end" DATETIME,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT 0,
    "trial_ends_at" DATETIME,
    "trial_used_at" DATETIME,
    "seat_quantity" INTEGER,
    "seat_allowance_override" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

await ensureColumn("billing_account", "product_id", `"product_id" TEXT`);
await ensureColumn("billing_account", "trial_ends_at", `"trial_ends_at" DATETIME`);
await ensureColumn("billing_account", "trial_used_at", `"trial_used_at" DATETIME`);
await ensureColumn("billing_account", "seat_quantity", `"seat_quantity" INTEGER`);
await ensureColumn(
  "billing_account",
  "seat_allowance_override",
  `"seat_allowance_override" INTEGER`,
);

await prisma.$executeRawUnsafe(`
  CREATE UNIQUE INDEX IF NOT EXISTS "billing_account_owner_unique"
  ON "billing_account" ("owner_kind", "owner_id")
`);

await prisma.$executeRawUnsafe(`
  CREATE UNIQUE INDEX IF NOT EXISTS "billing_account_stripe_customer_id_unique"
  ON "billing_account" ("stripe_customer_id")
`);

await prisma.$executeRawUnsafe(`
  CREATE UNIQUE INDEX IF NOT EXISTS "billing_account_stripe_subscription_id_unique"
  ON "billing_account" ("stripe_subscription_id")
`);

await prisma.$executeRawUnsafe(`
  CREATE INDEX IF NOT EXISTS "billing_account_owner_id_idx"
  ON "billing_account" ("owner_id")
`);

await prisma.$executeRawUnsafe(`
  CREATE INDEX IF NOT EXISTS "billing_account_owner_kind_idx"
  ON "billing_account" ("owner_kind")
`);

await prisma.$executeRawUnsafe(`
  UPDATE "billing_account"
  SET
    "plan_id" = 'free',
    "product_id" = NULL,
    "status" = 'free',
    "seat_quantity" = NULL,
    "updated_at" = CURRENT_TIMESTAMP
  WHERE "plan_id" != 'free'
    AND "product_id" IS NULL
    AND "stripe_customer_id" IS NULL
    AND "stripe_subscription_id" IS NULL
`);

await prisma.$executeRawUnsafe(`
  CREATE TABLE IF NOT EXISTS "organization_project" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

await prisma.$executeRawUnsafe(`
  CREATE INDEX IF NOT EXISTS "organization_project_org_id_idx"
  ON "organization_project" ("organization_id")
`);

await prisma.$executeRawUnsafe(`
  CREATE TABLE IF NOT EXISTS "organization_token_usage" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "organization_id" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

await prisma.$executeRawUnsafe(`
  CREATE INDEX IF NOT EXISTS "organization_token_usage_org_id_idx"
  ON "organization_token_usage" ("organization_id")
`);

await prisma.$executeRawUnsafe(`
  CREATE INDEX IF NOT EXISTS "organization_token_usage_created_at_idx"
  ON "organization_token_usage" ("created_at")
`);
