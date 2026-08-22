// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { FarmIntegrationHandlerContext } from "../integrations";
import { polar, type PolarIntegrationInstance } from "../../../farm-integrations/src/polar/index";

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
      type: "polar",
      instance,
    },
    route: {
      kind: "route",
      path,
      methods: [method],
    },
    req,
    requestContext: req,
    config: {} as FarmIntegrationHandlerContext["config"],
    isDev: true,
    isProd: false,
  };
}

function createFakeSdk(state: unknown, product?: unknown) {
  return {
    customers: {
      getStateExternal: vi.fn(async () => state),
    },
    events: {
      ingest: vi.fn(async () => ({ inserted: 1 })),
    },
    products: {
      get: vi.fn(async () => product),
    },
  };
}

async function callRoute(
  integration: ReturnType<typeof polar>,
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const route = integration.routes.find(
    (candidate) => candidate.path === path && candidate.method === "POST",
  );
  expect(route).toBeTruthy();

  const request = new Request(`http://example.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return route!.handler(request, createContext(request, "POST", path, integration.instance));
}

describe("polar billing usage", () => {
  it("lets a gauge (last) meter report a decrease without tripping the hard cap", async () => {
    const sdk = createFakeSdk({
      id: "cus_gauge",
      activeSubscriptions: [],
      activeMeters: [{ meterId: "mtr_gauge", consumedUnits: 90, creditedUnits: 0, balance: 0 }],
    });
    const integration = polar({
      instance: sdk as unknown as PolarIntegrationInstance,
      billing: {
        resolveOwner: () => ({ kind: "user", id: "gauge-user" }),
        meters: {
          concurrency: {
            aggregation: "last",
            eventName: "concurrency.sampled",
            meterId: "mtr_gauge",
            guard: { hardLimit: 100 },
          },
        },
      },
    });

    const response = await callRoute(integration, "/billing/report-usage", {
      key: "concurrency",
      quantity: 50,
      idempotencyKey: "evt-gauge-1",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      key: "concurrency",
      currentPeriodUsed: 90,
      projectedCurrentPeriodUsed: 50,
      state: "ok",
    });
    expect(sdk.events.ingest).toHaveBeenCalledTimes(1);
  });

  it("still blocks sum meters whose projection exceeds the hard cap", async () => {
    const sdk = createFakeSdk({
      id: "cus_sum",
      activeSubscriptions: [],
      activeMeters: [{ meterId: "mtr_sum", consumedUnits: 90, creditedUnits: 0, balance: 0 }],
    });
    const integration = polar({
      instance: sdk as unknown as PolarIntegrationInstance,
      billing: {
        resolveOwner: () => ({ kind: "user", id: "sum-user" }),
        meters: {
          api_calls: {
            aggregation: "sum",
            eventName: "api.called",
            meterId: "mtr_sum",
            guard: { hardLimit: 100 },
          },
        },
      },
    });

    const response = await callRoute(integration, "/billing/report-usage", {
      key: "api_calls",
      quantity: 20,
      idempotencyKey: "evt-sum-1",
    });

    expect(response.status).toBe(409);
    expect(sdk.events.ingest).not.toHaveBeenCalled();
  });

  it("estimates catalog meter charges in cents without scaling by 100 again", async () => {
    const sdk = createFakeSdk(
      {
        id: "cus_charge",
        activeSubscriptions: [
          {
            id: "sub_1",
            productId: "prod_1",
            status: "active",
            createdAt: new Date("2026-08-01T00:00:00Z"),
            currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
            amount: 1500,
            currency: "usd",
            meters: [{ meterId: "mtr_calls", consumedUnits: 500, creditedUnits: 0 }],
          },
        ],
        activeMeters: [{ meterId: "mtr_calls", consumedUnits: 500, creditedUnits: 0, balance: 0 }],
      },
      {
        prices: [
          {
            amountType: "metered_unit",
            meterId: "mtr_calls",
            // Polar expresses the metered unit amount in cents.
            unitAmount: "2",
            capAmount: null,
            meter: { name: "API calls" },
          },
        ],
      },
    );
    const integration = polar({
      instance: sdk as unknown as PolarIntegrationInstance,
      billing: {
        resolveOwner: () => ({ kind: "user", id: "charge-user" }),
        products: {
          pro: { kind: "subscription", planId: "pro", productId: "prod_1" },
        },
        plans: { pro: {} },
        meters: {
          api_calls: { aggregation: "sum", eventName: "api.called", meterId: "mtr_calls" },
        },
      },
    });

    const response = await callRoute(integration, "/billing/meter-usage", {
      key: "api_calls",
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    // 500 units at 2 cents each: 1000 cents, not 100000.
    expect(result).toMatchObject({
      key: "api_calls",
      currentPeriodUsed: 500,
      chargeSource: "catalog_rate",
      baseSubscriptionAmount: 1500,
      estimatedMeterChargeAmount: 1000,
      estimatedCombinedAmount: 2500,
    });
  });

  it("caps the estimated charge at the configured cap amount", async () => {
    const sdk = createFakeSdk(
      {
        id: "cus_cap",
        activeSubscriptions: [
          {
            id: "sub_2",
            productId: "prod_2",
            status: "active",
            createdAt: new Date("2026-08-01T00:00:00Z"),
            currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
            amount: 0,
            currency: "usd",
            meters: [{ meterId: "mtr_capped", consumedUnits: 5000, creditedUnits: 0 }],
          },
        ],
        activeMeters: [
          { meterId: "mtr_capped", consumedUnits: 5000, creditedUnits: 0, balance: 0 },
        ],
      },
      {
        prices: [
          {
            amountType: "metered_unit",
            meterId: "mtr_capped",
            unitAmount: "2",
            capAmount: 5000,
            meter: { name: "API calls" },
          },
        ],
      },
    );
    const integration = polar({
      instance: sdk as unknown as PolarIntegrationInstance,
      billing: {
        resolveOwner: () => ({ kind: "user", id: "cap-user" }),
        products: {
          pro: { kind: "subscription", planId: "pro", productId: "prod_2" },
        },
        plans: { pro: {} },
        meters: {
          api_calls: { aggregation: "sum", eventName: "api.called", meterId: "mtr_capped" },
        },
      },
    });

    const response = await callRoute(integration, "/billing/meter-usage", {
      key: "api_calls",
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    // 5000 units at 2 cents is 10000 cents, capped at 5000. Before the fix the
    // uncapped estimate (1,000,000) pinned every reading at the cap.
    expect(result.estimatedMeterChargeAmount).toBe(5000);
  });
});
