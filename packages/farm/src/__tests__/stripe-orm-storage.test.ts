// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FarmIntegrationHandlerContext } from "../integrations";
import { stripe } from "../../../farm-integrations/src/stripe/index";

type SqliteDatabase = {
  exec(sql: string): unknown;
  close(): unknown;
};

const requireModule = createRequire(import.meta.url);
const tempDirs = new Set<string>();
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
const supportsNodeSqlite = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 5);

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

async function createSqliteDatabase(filePath: string): Promise<SqliteDatabase> {
  const { DatabaseSync } = requireModule("node:sqlite") as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  return new DatabaseSync(filePath) as SqliteDatabase;
}

function createRequestContextStore() {
  return {
    get() {
      return undefined;
    },
    set() {},
    has() {
      return false;
    },
    delete() {
      return false;
    },
    clear() {},
    snapshot() {
      return new Map<string, unknown>();
    },
  };
}

function createContext(
  request: Request,
  method: string,
  path: string,
  instance: unknown,
  config: FarmIntegrationHandlerContext["config"],
): FarmIntegrationHandlerContext {
  const req = createRequestContextStore();

  return {
    request,
    requestId: "req_test",
    url: new URL(request.url),
    pathname: new URL(request.url).pathname,
    method,
    params: {},
    input: {},
    data: {},
    integration: {
      category: "payment",
      slot: "payment",
      type: "stripe",
      instance,
    },
    route: {
      kind: "route",
      path,
      methods: [method],
    },
    req,
    requestContext: req,
    config,
    isDev: true,
    isProd: false,
  };
}

describe("stripe ORM-backed storage", () => {
  afterEach(async () => {
    await Promise.all(
      [...tempDirs].map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
        tempDirs.delete(dir);
      }),
    );
  });

  it.skipIf(!supportsNodeSqlite)(
    "uses farm.config storage.client as billing storage through the integration route",
    async () => {
      const dir = await createTempDir("farm-stripe-orm-storage-");
      const db = await createSqliteDatabase(path.join(dir, "stripe.sqlite"));

      try {
        db.exec(`
        CREATE TABLE billing_account (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          owner_kind TEXT NOT NULL DEFAULT 'user',
          stripe_customer_id TEXT UNIQUE,
          stripe_subscription_id TEXT UNIQUE,
          plan_id TEXT NOT NULL DEFAULT 'free',
          product_id TEXT,
          status TEXT NOT NULL DEFAULT 'free',
          current_period_end TEXT,
          cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
          trial_ends_at TEXT,
          trial_used_at TEXT,
          seat_quantity INTEGER,
          seat_allowance_override INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(owner_kind, owner_id)
        );

        INSERT INTO billing_account (
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
          seat_allowance_override
        ) VALUES (
          'acct_orm_1',
          'user_orm_1',
          'user',
          'cus_orm_1',
          'sub_orm_1',
          'pro',
          'proMonthly',
          'active',
          '2026-01-02T03:04:05.000Z',
          1,
          NULL,
          '2025-12-20T00:00:00.000Z',
          4,
          8
        );
      `);

        const owner = {
          kind: "user" as const,
          id: "user_orm_1",
          email: "owner@example.com",
        };
        let ownerArgsClient: unknown;
        let ownerArgsOrmStatus: unknown;
        const integration = stripe({
          instance: {
            async createCheckoutSession() {
              return {
                id: "cs_unused",
                url: "https://example.com/checkout/cs_unused",
              };
            },
            async createPortalSession() {
              return {
                url: "https://example.com/portal",
              };
            },
            async retrieveCheckoutSession() {
              throw new Error("retrieveCheckoutSession should not be called by this test.");
            },
            async constructWebhookEvent() {
              throw new Error("constructWebhookEvent should not be called by this test.");
            },
          },
          billing: {
            async resolveOwner(_context, args) {
              if (!args) {
                throw new Error("Expected Stripe billing args.");
              }

              ownerArgsClient = await args.storage.getClient();
              const orm = (await args.storage.getOrm()) as {
                billingAccount: {
                  findFirst(args: {
                    where: Record<string, unknown>;
                  }): Promise<Record<string, unknown> | null>;
                };
              };
              const account = await orm.billingAccount.findFirst({
                where: {
                  ownerId: owner.id,
                },
              });
              ownerArgsOrmStatus = account?.status;
              return owner;
            },
            plans: {
              free: {
                public: true,
              },
              pro: {
                public: true,
                features: {
                  teams: true,
                },
                limits: {
                  seats: 5,
                },
              },
            },
            products: {
              proMonthly: {
                public: true,
                kind: "subscription",
                planId: "pro",
                name: "Pro Monthly",
                currency: "usd",
                unitAmount: 1200,
                interval: "month",
              },
            },
          },
        });
        const route = integration.routes.find(
          (candidate) => candidate.path === "/billing/status" && candidate.method === "GET",
        );
        expect(route).toBeTruthy();

        const request = new Request("http://example.com/billing/status", {
          method: "GET",
        });
        const response = await route!.handler(
          request,
          createContext(request, "GET", "/billing/status", integration.instance, {
            storage: {
              client: db,
            },
          }),
        );
        const json = JSON.parse(await response.text()) as Record<string, unknown>;

        expect(response.status).toBe(200);
        expect(ownerArgsClient).toBe(db);
        expect(ownerArgsOrmStatus).toBe("active");
        expect(json).toMatchObject({
          owner: {
            kind: "user",
            id: "user_orm_1",
          },
          planId: "pro",
          productId: "proMonthly",
          status: "active",
          stripeCustomerId: "cus_orm_1",
          stripeSubscriptionId: "sub_orm_1",
          currentPeriodEnd: "2026-01-02T03:04:05.000Z",
          cancelAtPeriodEnd: true,
          trialUsedAt: "2025-12-20T00:00:00.000Z",
          seatQuantity: 4,
          seatAllowanceOverride: 8,
          features: {
            teams: true,
          },
          limits: {
            seats: 8,
          },
        });
      } finally {
        db.close();
      }
    },
  );
});
