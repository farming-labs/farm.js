import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

await prisma.$executeRawUnsafe(`
  CREATE TABLE IF NOT EXISTS "billing_account" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "owner_id" TEXT NOT NULL,
    "owner_kind" TEXT NOT NULL DEFAULT 'user',
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "plan_id" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'free',
    "current_period_end" DATETIME,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

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
