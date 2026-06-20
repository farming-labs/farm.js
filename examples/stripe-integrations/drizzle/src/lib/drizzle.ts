import path from "node:path";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { billingBillingAccount } from "../../farm-integrations.generated.ts";

const sqlite = new Database(path.join(process.cwd(), "billing.sqlite"));

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS "billing_account" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "owner_id" TEXT NOT NULL,
    "owner_kind" TEXT NOT NULL DEFAULT 'user',
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "plan_id" TEXT NOT NULL DEFAULT 'free',
    "product_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'free',
    "current_period_end" INTEGER,
    "cancel_at_period_end" INTEGER NOT NULL DEFAULT 0,
    "created_at" INTEGER NOT NULL,
    "updated_at" INTEGER NOT NULL
  )
`);
try {
  sqlite.exec(`ALTER TABLE "billing_account" ADD COLUMN "product_id" TEXT`);
} catch {
  // Existing demo databases may already include the column.
}

sqlite.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS "billing_account_owner_unique"
  ON "billing_account" ("owner_kind", "owner_id")
`);

sqlite.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS "billing_account_stripe_customer_id_unique"
  ON "billing_account" ("stripe_customer_id")
`);

sqlite.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS "billing_account_stripe_subscription_id_unique"
  ON "billing_account" ("stripe_subscription_id")
`);

sqlite.exec(`
  CREATE INDEX IF NOT EXISTS "billing_account_owner_id_idx"
  ON "billing_account" ("owner_id")
`);

sqlite.exec(`
  CREATE INDEX IF NOT EXISTS "billing_account_owner_kind_idx"
  ON "billing_account" ("owner_kind")
`);

export const drizzleDb = drizzle(sqlite);
export { and, billingBillingAccount, eq };
