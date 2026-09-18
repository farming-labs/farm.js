// @vitest-environment node

import { describe, expect, it } from "vitest";
import { prismaStorageAdapter, type StripeBillingSnapshot } from "../../../farm-stripe/src/storage";

type Row = Record<string, unknown> & { id: string };

/**
 * Prisma's query engine surfaces `Unknown argument \`<field>\`` validation
 * errors one at a time, naming the unknown argument that appears first in the
 * `data` object's key-insertion order. This fake reproduces that contract: on
 * each create/update it scans `Object.keys(data)` in insertion order and
 * throws for the first key that belongs to the (schema-)missing set, so the
 * fallback helper must drop the field Prisma actually reported and retry.
 */
class UnknownArgumentError extends Error {
  constructor(field: string) {
    super(`Unknown argument \`${field}\`. Available options are marked with ?.`);
    this.name = "PrismaClientValidationError";
  }
}

function createFakeStripe() {
  let count = 0;
  return {
    client: {
      customers: {
        async create() {
          count += 1;
          return { id: `cus_${count}` };
        },
      },
    },
  };
}

function createFakePrisma(
  options: {
    missingColumns?: ReadonlySet<string>;
    rows?: readonly Row[];
    errorFactory?: (field: string) => Error;
  } = {},
) {
  const missingColumns = options.missingColumns ?? new Set<string>();
  const rows: Row[] = options.rows ? options.rows.map((row) => ({ ...row })) : [];
  let nextId = 1;

  const createAttempts: Record<string, unknown>[] = [];
  const updateAttempts: Array<{
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }> = [];

  const errorFactory = options.errorFactory ?? ((field: string) => new UnknownArgumentError(field));

  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key] === value);

  function firstUnknownField(data: Record<string, unknown>): string | null {
    for (const key of Object.keys(data)) {
      if (missingColumns.has(key)) {
        return key;
      }
    }
    return null;
  }

  const billingBillingAccount = {
    async findFirst({ where }: { where: Record<string, unknown> }) {
      return rows.find((row) => matches(row, where)) ?? null;
    },
    async create({ data }: { data: Record<string, unknown> }) {
      createAttempts.push({ ...data });
      const unknown = firstUnknownField(data);
      if (unknown) {
        throw errorFactory(unknown);
      }
      const row: Row = { id: `row_${nextId++}`, ...data } as Row;
      rows.push(row);
      return row;
    },
    async update({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) {
      updateAttempts.push({ where: { ...where }, data: { ...data } });
      const unknown = firstUnknownField(data);
      if (unknown) {
        throw errorFactory(unknown);
      }
      const row = rows.find((candidate) => matches(candidate, where));
      if (row) {
        Object.assign(row, data);
        return row;
      }
      return { id: String(where.id ?? `row_${nextId++}`), ...data } as Row;
    },
  };

  return {
    rows,
    createAttempts,
    updateAttempts,
    prisma: { billingBillingAccount },
  };
}

const owner = (id: string): { kind: "user"; id: string; email: string } => ({
  kind: "user",
  id,
  email: `${id}@example.com`,
});

function snapshot(overrides: Partial<StripeBillingSnapshot> = {}): StripeBillingSnapshot {
  return {
    owner: { kind: "user", id: "user_snap" },
    planId: "pro",
    productId: "prod_1",
    status: "active",
    stripeCustomerId: "cus_snap",
    stripeSubscriptionId: "sub_1",
    currentPeriodEnd: new Date("2026-12-31T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    trialEndsAt: null,
    trialUsedAt: null,
    seatQuantity: 3,
    seatAllowanceOverride: 5,
    ...overrides,
  };
}

describe("stripe prisma storage fallback", () => {
  describe("ensureCustomer create path", () => {
    it("persists when the schema is missing a mid-list fallback column (trialEndsAt)", async () => {
      // Bug-report scenario B: schema missing only trialEndsAt. Prisma reports
      // `trialEndsAt` (earliest missing data key), but fallbackFields[0] is
      // `seatAllowanceOverride`, so the old per-iteration guard re-threw on
      // iteration 0. The fixed helper extracts the reported field and retries.
      const fake = createFakePrisma({ missingColumns: new Set(["trialEndsAt"]) });
      const stripe = createFakeStripe();
      const adapter = prismaStorageAdapter({ prisma: fake.prisma });

      const result = await adapter.ensureCustomer({
        owner: owner("user_1"),
        stripe: stripe.client as never,
      });

      expect(result.customerId).toMatch(/^cus_\d+$/);
      expect(fake.rows).toHaveLength(1);
      expect(fake.createAttempts).toHaveLength(2);
      const row = fake.rows[0]!;
      expect(row.ownerId).toBe("user_1");
      expect(row.ownerKind).toBe("user");
      expect(row.stripeCustomerId).toBe(result.customerId);
      expect(row.planId).toBe("free");
      expect(row.status).toBe("free");
      expect(row.cancelAtPeriodEnd).toBe(false);
      expect("trialEndsAt" in row).toBe(false);
      // schema-present fallback columns are still persisted.
      expect(row.productId).toBeNull();
      expect(row.trialUsedAt).toBeNull();
      expect(row.seatQuantity).toBeNull();
      expect(row.seatAllowanceOverride).toBeNull();
    });

    it("persists when the schema is missing every fallback-covered column", async () => {
      // Bug-report scenario A: all five fallback-covered columns missing.
      // Prisma reports them in data-key order (productId, trialEndsAt,
      // trialUsedAt, seatQuantity, seatAllowanceOverride); the helper drops
      // each in turn across six attempts (5 throws + 1 success).
      const fake = createFakePrisma({
        missingColumns: new Set([
          "productId",
          "trialEndsAt",
          "trialUsedAt",
          "seatQuantity",
          "seatAllowanceOverride",
        ]),
      });
      const stripe = createFakeStripe();
      const adapter = prismaStorageAdapter({ prisma: fake.prisma });

      const result = await adapter.ensureCustomer({
        owner: owner("user_2"),
        stripe: stripe.client as never,
      });

      expect(result.customerId).toMatch(/^cus_\d+$/);
      expect(fake.rows).toHaveLength(1);
      expect(fake.createAttempts).toHaveLength(6);
      const row = fake.rows[0]!;
      expect(row.ownerId).toBe("user_2");
      expect(row.stripeCustomerId).toBe(result.customerId);
      expect("productId" in row).toBe(false);
      expect("trialEndsAt" in row).toBe(false);
      expect("trialUsedAt" in row).toBe(false);
      expect("seatQuantity" in row).toBe(false);
      expect("seatAllowanceOverride" in row).toBe(false);
      expect("trialEndsAt" in fake.createAttempts[5]!).toBe(false);
    });

    it("persists on a full schema without invoking the fallback", async () => {
      const fake = createFakePrisma();
      const stripe = createFakeStripe();
      const adapter = prismaStorageAdapter({ prisma: fake.prisma });

      const result = await adapter.ensureCustomer({
        owner: owner("user_4"),
        stripe: stripe.client as never,
      });

      expect(result.customerId).toMatch(/^cus_\d+$/);
      expect(fake.rows).toHaveLength(1);
      expect(fake.createAttempts).toHaveLength(1);
      const row = fake.rows[0]!;
      expect(row.productId).toBeNull();
      expect(row.trialEndsAt).toBeNull();
      expect(row.trialUsedAt).toBeNull();
      expect(row.seatQuantity).toBeNull();
      expect(row.seatAllowanceOverride).toBeNull();
    });

    it("re-throws when the unknown argument is not a fallback field", async () => {
      // ownerId is a required column and never in fallbackFields; a schema
      // missing it is not a graceful-degradation case, so the original error
      // must escape the adapter.
      const fake = createFakePrisma({ missingColumns: new Set(["ownerId"]) });
      const stripe = createFakeStripe();
      const adapter = prismaStorageAdapter({ prisma: fake.prisma });

      await expect(
        adapter.ensureCustomer({ owner: owner("user_5"), stripe: stripe.client as never }),
      ).rejects.toThrow("Unknown argument `ownerId`");
      expect(fake.rows).toHaveLength(0);
      expect(fake.createAttempts).toHaveLength(1);
    });

    it("re-throws non-Prisma errors unchanged", async () => {
      const stripe = createFakeStripe();
      const adapter = prismaStorageAdapter({
        prisma: {
          billingBillingAccount: {
            async findFirst() {
              return null;
            },
            async create() {
              throw new Error("Connection refused");
            },
            async update({
              data,
            }: {
              where: Record<string, unknown>;
              data: Record<string, unknown>;
            }) {
              return { id: "x", ...data };
            },
          },
        },
      });

      await expect(
        adapter.ensureCustomer({ owner: owner("user_6"), stripe: stripe.client as never }),
      ).rejects.toThrow("Connection refused");
    });

    it("recovers from a realistic multiline Prisma validation message", async () => {
      // Prisma renders the validation error across several indented lines;
      // the extractor normalizes whitespace before matching.
      const errorFactory = (field: string) =>
        new Error(
          [
            "Invalid `prisma.billingAccount.create()` invocation:",
            "{",
            "  data: {",
            `    ${field}: null,`,
            `    ${"~".repeat(field.length)}`,
            "    ...",
            "  }",
            "}",
            `Unknown argument \`${field}\`. Available options are marked with ?.`,
          ].join("\n"),
        );
      const fake = createFakePrisma({
        missingColumns: new Set(["trialUsedAt"]),
        errorFactory,
      });
      const stripe = createFakeStripe();
      const adapter = prismaStorageAdapter({ prisma: fake.prisma });

      const result = await adapter.ensureCustomer({
        owner: owner("user_7"),
        stripe: stripe.client as never,
      });

      expect(result.customerId).toMatch(/^cus_\d+$/);
      expect(fake.rows).toHaveLength(1);
      expect("trialUsedAt" in fake.rows[0]!).toBe(false);
    });
  });

  describe("saveBillingSnapshot create path", () => {
    it("persists a snapshot when the schema is missing a mid-list column (trialUsedAt)", async () => {
      const fake = createFakePrisma({ missingColumns: new Set(["trialUsedAt"]) });
      const adapter = prismaStorageAdapter({ prisma: fake.prisma });

      await adapter.saveBillingSnapshot(snapshot({ owner: { kind: "user", id: "user_snap" } }));

      expect(fake.rows).toHaveLength(1);
      expect(fake.createAttempts).toHaveLength(2);
      expect("trialUsedAt" in fake.createAttempts[1]!).toBe(false);
      const row = fake.rows[0]!;
      expect(row.ownerId).toBe("user_snap");
      expect(row.planId).toBe("pro");
      expect(row.productId).toBe("prod_1");
      expect(row.status).toBe("active");
      expect(row.seatQuantity).toBe(3);
      expect(row.seatAllowanceOverride).toBe(5);
      expect("trialUsedAt" in row).toBe(false);
    });
  });

  describe("saveBillingSnapshot update path", () => {
    it("updates an existing row when the schema is missing multiple fallback columns", async () => {
      // Missing {productId, trialEndsAt, seatAllowanceOverride}: Prisma reports
      // them in data-key order across four attempts (3 throws + 1 success).
      const seeded: Row[] = [
        {
          id: "existing_1",
          ownerId: "user_upd",
          ownerKind: "user",
          stripeCustomerId: null,
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
        },
      ];
      const fake = createFakePrisma({
        missingColumns: new Set(["productId", "trialEndsAt", "seatAllowanceOverride"]),
        rows: seeded,
      });
      const adapter = prismaStorageAdapter({ prisma: fake.prisma });

      await adapter.saveBillingSnapshot(
        snapshot({
          owner: { kind: "user", id: "user_upd" },
          stripeCustomerId: "cus_upd",
          stripeSubscriptionId: "sub_upd",
          seatQuantity: 2,
        }),
      );

      expect(fake.rows).toHaveLength(1);
      expect(fake.updateAttempts).toHaveLength(4);
      const finalData = fake.updateAttempts[3]!.data;
      expect("productId" in finalData).toBe(false);
      expect("trialEndsAt" in finalData).toBe(false);
      expect("seatAllowanceOverride" in finalData).toBe(false);
      expect("seatQuantity" in finalData).toBe(true);

      const row = fake.rows[0]!;
      expect(row.id).toBe("existing_1");
      expect(row.planId).toBe("pro");
      expect(row.status).toBe("active");
      expect(row.stripeCustomerId).toBe("cus_upd");
      expect(row.stripeSubscriptionId).toBe("sub_upd");
      expect(row.seatQuantity).toBe(2);
      // The missing columns are not part of the persisted payload; the existing
      // row retains whatever was already stored for them.
      expect(row.seatAllowanceOverride).toBeNull();
    });
  });

  describe("clearBillingSnapshot update path", () => {
    it("clears an existing row when the schema is missing all clear fallback columns", async () => {
      // Bug-report scenario U1: clearBillingSnapshot data keys productId,
      // trialEndsAt, seatQuantity all missing while fallbackFields is
      // ["seatQuantity", "trialEndsAt", "productId"]. The old guard matched
      // fallbackFields[0]=seatQuantity against the reported productId and
      // re-threw on iteration 0.
      const seeded: Row[] = [
        {
          id: "existing_2",
          ownerId: "user_clr",
          ownerKind: "user",
          stripeCustomerId: "cus_clr",
          stripeSubscriptionId: "sub_clr",
          planId: "pro",
          productId: "prod_clr",
          status: "active",
          currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
          cancelAtPeriodEnd: false,
          trialEndsAt: null,
          trialUsedAt: null,
          seatQuantity: 1,
          seatAllowanceOverride: null,
        },
      ];
      const fake = createFakePrisma({
        missingColumns: new Set(["productId", "trialEndsAt", "seatQuantity"]),
        rows: seeded,
      });
      const adapter = prismaStorageAdapter({ prisma: fake.prisma });

      await adapter.clearBillingSnapshot({ kind: "user", id: "user_clr" });

      expect(fake.updateAttempts).toHaveLength(4);
      const finalData = fake.updateAttempts[3]!.data;
      expect("productId" in finalData).toBe(false);
      expect("trialEndsAt" in finalData).toBe(false);
      expect("seatQuantity" in finalData).toBe(false);

      const row = fake.rows[0]!;
      expect(row.planId).toBe("free");
      expect(row.status).toBe("free");
      expect(row.stripeSubscriptionId).toBeNull();
      expect(row.currentPeriodEnd).toBeNull();
      expect(row.cancelAtPeriodEnd).toBe(false);
    });
  });
});
