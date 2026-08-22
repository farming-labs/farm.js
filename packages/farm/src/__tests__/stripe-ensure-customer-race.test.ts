// @vitest-environment node

import { describe, expect, it } from "vitest";
import { ormStorageAdapter } from "../../../farm-stripe/src/storage";

type Row = Record<string, unknown> & { id: string };

function createFakeOrm() {
  const rows: Row[] = [];
  let nextId = 1;

  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key] === value);

  return {
    rows,
    orm: {
      billingAccount: {
        async findFirst({ where }: { where: Record<string, unknown> }) {
          return rows.find((row) => matches(row, where)) ?? null;
        },
        async create({ data }: { data: Record<string, unknown> }) {
          const row: Row = { id: `row_${nextId++}`, ...data };
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
          const row = rows.find((candidate) => matches(candidate, where));
          if (row) Object.assign(row, data);
          return row ?? null;
        },
      },
    },
  };
}

/**
 * Fake Stripe client that honors idempotency keys the way Stripe does: the
 * same key returns the same customer. Creation is gated so the test can hold
 * both concurrent calls inside the race window.
 */
function createFakeStripe() {
  const created: Array<{ id: string; idempotencyKey?: string }> = [];
  const byIdempotencyKey = new Map<string, { id: string }>();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    created,
    release: () => release(),
    client: {
      customers: {
        async create(
          _params: Record<string, unknown>,
          requestOptions?: { idempotencyKey?: string },
        ) {
          await gate;
          const key = requestOptions?.idempotencyKey;
          if (key && byIdempotencyKey.has(key)) {
            return byIdempotencyKey.get(key)!;
          }
          const customer = { id: `cus_${created.length + 1}` };
          created.push({ id: customer.id, idempotencyKey: key });
          if (key) byIdempotencyKey.set(key, customer);
          return customer;
        },
      },
    },
  };
}

describe("stripe ensureCustomer race", () => {
  it("settles concurrent calls on one customer and one billing row", async () => {
    const fakeOrm = createFakeOrm();
    const fakeStripe = createFakeStripe();
    const adapter = ormStorageAdapter({ orm: fakeOrm.orm });
    const owner = { kind: "user" as const, id: "user_1", email: "ada@example.com" };

    // Both requests pass the "no existing customer" check before either
    // create resolves — the double-click / two-tab scenario.
    const first = adapter.ensureCustomer({ owner, stripe: fakeStripe.client as never });
    const second = adapter.ensureCustomer({ owner, stripe: fakeStripe.client as never });
    await new Promise((resolve) => setTimeout(resolve, 10));
    fakeStripe.release();

    const [firstResult, secondResult] = await Promise.all([first, second]);

    // One Stripe customer, not two.
    expect(fakeStripe.created).toHaveLength(1);
    expect(fakeStripe.created[0].idempotencyKey).toBe("farm-ensure-customer-user-user_1");
    // Both callers agree on it.
    expect(firstResult.customerId).toBe(fakeStripe.created[0].id);
    expect(secondResult.customerId).toBe(fakeStripe.created[0].id);
    // And only one billing row exists.
    const customerRows = fakeOrm.rows.filter((row) => row.stripeCustomerId);
    expect(customerRows).toHaveLength(1);
    expect(customerRows[0].stripeCustomerId).toBe(firstResult.customerId);
  });

  it("returns the stored customer on later calls without touching Stripe", async () => {
    const fakeOrm = createFakeOrm();
    const fakeStripe = createFakeStripe();
    fakeStripe.release();
    const adapter = ormStorageAdapter({ orm: fakeOrm.orm });
    const owner = { kind: "user" as const, id: "user_2", email: "grace@example.com" };

    const created = await adapter.ensureCustomer({ owner, stripe: fakeStripe.client as never });
    const again = await adapter.ensureCustomer({ owner, stripe: fakeStripe.client as never });

    expect(again.customerId).toBe(created.customerId);
    expect(fakeStripe.created).toHaveLength(1);
  });
});
