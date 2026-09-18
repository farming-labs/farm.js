// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FarmIntegrationHandlerContext } from "../integrations";
import { autumn, type AutumnIntegrationInstance } from "../../../farm-autumn/src/index";

const HOUR = 60 * 60 * 1000;

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
      type: "autumn",
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

interface FakePurchase {
  planId: string;
  expiresAt: number | null;
  startedAt: number;
  quantity: number;
}

function createFakeSdk(customer: Record<string, unknown>) {
  return {
    customers: {
      getOrCreate: vi.fn(async () => customer),
    },
    plans: {
      get: vi.fn(async () => ({ id: "plan", items: [] })),
      list: vi.fn(async () => ({ list: [] })),
    },
    balances: {
      update: vi.fn(async () => ({})),
    },
    billing: {
      update: vi.fn(async () => ({})),
    },
  };
}

function buildIntegration(ownerId: string, purchases: FakePurchase[]): ReturnType<typeof autumn> {
  const customer = { id: "cus_1", subscriptions: [], purchases };
  return autumn({
    instance: createFakeSdk(customer) as unknown as AutumnIntegrationInstance,
    billing: {
      resolveOwner: () => ({ kind: "user" as const, id: ownerId }),
      plans: {
        free: { features: {}, limits: {} },
        pro: { features: { billingPortal: true }, limits: { seats: 5 } },
      },
      products: {
        pro: {
          kind: "one_time",
          planId: "pro",
          autumn: { planId: "pro" },
        },
      },
    },
  });
}

async function callGet(integration: ReturnType<typeof autumn>, path: string): Promise<Response> {
  const route = integration.routes.find(
    (candidate) => candidate.path === path && candidate.method === "GET",
  );
  expect(route).toBeTruthy();
  const request = new Request(`http://example.com${path}`, { method: "GET" });
  return route!.handler(request, createContext(request, "GET", path, integration.instance));
}

describe("autumn /billing/status classifies expired one-time purchases", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("reports an expired purchase as canceled, not active", async () => {
    const integration = buildIntegration("expired-user", [
      { planId: "pro", expiresAt: Date.now() - HOUR, startedAt: Date.now() - HOUR, quantity: 1 },
    ]);

    const response = await callGet(integration, "/billing/status");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "canceled",
      planId: "pro",
      productId: "pro",
      subscriptionId: null,
    });
  });

  it("reports a lifetime purchase (expiresAt: null) as active", async () => {
    const integration = buildIntegration("lifetime-user", [
      { planId: "pro", expiresAt: null, startedAt: Date.now() - HOUR, quantity: 1 },
    ]);

    const response = await callGet(integration, "/billing/status");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "active",
      planId: "pro",
      productId: "pro",
    });
  });

  it("treats expiresAt equal to now as expired and any later value as active", async () => {
    vi.useFakeTimers();
    const fixedNow = new Date("2026-01-15T12:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    const expired = buildIntegration("boundary-expired", [
      { planId: "pro", expiresAt: fixedNow, startedAt: fixedNow - HOUR, quantity: 1 },
    ]);
    expect(await (await callGet(expired, "/billing/status")).json()).toMatchObject({
      status: "canceled",
      planId: "pro",
    });

    const active = buildIntegration("boundary-active", [
      { planId: "pro", expiresAt: fixedNow + 1, startedAt: fixedNow - HOUR, quantity: 1 },
    ]);
    expect(await (await callGet(active, "/billing/status")).json()).toMatchObject({
      status: "active",
      planId: "pro",
    });
  });

  it("applies the expiry check to the most recently started matching purchase", async () => {
    const integration = buildIntegration("multi-user", [
      { planId: "pro", expiresAt: null, startedAt: Date.now() - 2 * HOUR, quantity: 1 },
      { planId: "pro", expiresAt: Date.now() - HOUR, startedAt: Date.now() - HOUR, quantity: 1 },
    ]);

    const response = await callGet(integration, "/billing/status");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "canceled",
      planId: "pro",
      productId: "pro",
    });
  });
});
