// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { FarmIntegrationHandlerContext } from "../integrations";
import {
  autumn,
  type AutumnIntegrationInstance,
} from "../../../farm-integrations/src/autumn/index";

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

function createIntegration(sdk: ReturnType<typeof createFakeSdk>, ownerId: string) {
  return autumn({
    instance: sdk as unknown as AutumnIntegrationInstance,
    billing: {
      resolveOwner: () => ({ kind: "user" as const, id: ownerId }),
      meters: {
        credits: { aggregation: "sum" as const, featureId: "credits" },
      },
    },
  });
}

async function report(
  integration: ReturnType<typeof autumn>,
  body: Record<string, unknown>,
): Promise<Response> {
  const path = "/billing/report-usage";
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

describe("autumn usage-report idempotency", () => {
  it("applies a report once and replays retries with the same key", async () => {
    const sdk = createFakeSdk({
      id: "cus_1",
      balances: { credits: { usage: 0, granted: 100 } },
      subscriptions: [],
    });
    const integration = createIntegration(sdk, "idem-user");

    const first = await report(integration, {
      key: "credits",
      quantity: 10,
      idempotencyKey: "evt-1",
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({
      eventIdentifier: "evt-1",
      projectedCurrentPeriodUsed: 10,
    });
    expect(sdk.balances.update).toHaveBeenCalledTimes(1);
    expect(sdk.balances.update).toHaveBeenCalledWith(
      expect.objectContaining({ featureId: "credits", usage: 10 }),
    );

    // The lost-response retry: same key, same payload.
    const retry = await report(integration, {
      key: "credits",
      quantity: 10,
      idempotencyKey: "evt-1",
    });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(firstBody);
    // No second write: the customer is not billed twice for one event.
    expect(sdk.balances.update).toHaveBeenCalledTimes(1);

    // A genuinely new event still applies.
    const second = await report(integration, {
      key: "credits",
      quantity: 5,
      idempotencyKey: "evt-2",
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ projectedCurrentPeriodUsed: 15 });
    expect(sdk.balances.update).toHaveBeenCalledTimes(2);
    expect(sdk.balances.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ featureId: "credits", usage: 15 }),
    );
  });

  it("rejects reports without an idempotencyKey", async () => {
    const sdk = createFakeSdk({
      id: "cus_2",
      balances: { credits: { usage: 0, granted: 100 } },
      subscriptions: [],
    });
    const integration = createIntegration(sdk, "no-key-user");

    const response = await report(integration, { key: "credits", quantity: 10 });
    expect(response.status).toBe(400);
    expect(sdk.balances.update).not.toHaveBeenCalled();
  });
});
