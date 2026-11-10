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
    // Autumn's track adds `value` to the stored usage and answers with the new balance.
    track: vi.fn(async (input: { value: number }) => ({ value: input.value, balance: null })),
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

function createIntegration(
  sdk: ReturnType<typeof createFakeSdk>,
  ownerId: string,
  allowedOrigins?: readonly string[],
) {
  return autumn({
    instance: sdk as unknown as AutumnIntegrationInstance,
    allowedOrigins,
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
  headers: Record<string, string> = { "content-type": "application/json" },
): Promise<Response> {
  const path = "/billing/report-usage";
  const route = integration.routes.find(
    (candidate) => candidate.path === path && candidate.method === "POST",
  );
  expect(route).toBeTruthy();

  const request = new Request(`http://example.com${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return route!.handler(request, createContext(request, "POST", path, integration.instance));
}

// A text/plain form on another site: the browser adds its page's Origin, and the body still parses
// as JSON. The route acts for whoever the visitor's session cookie names.
const crossSiteForm = {
  origin: "https://evil.example",
  "content-type": "text/plain",
  "sec-fetch-site": "cross-site",
};

describe("autumn billing routes and other sites", () => {
  it("refuses a cross-site POST before reporting usage for the signed-in caller", async () => {
    const sdk = createFakeSdk({
      id: "cus_1",
      balances: { credits: { usage: 0, granted: 100 } },
      subscriptions: [],
    });
    const integration = createIntegration(sdk, "csrf-user");

    const crossSite = await report(
      integration,
      { key: "credits", quantity: 50, idempotencyKey: "csrf-1" },
      crossSiteForm,
    );
    expect(crossSite.status).toBe(403);
    expect(sdk.track).not.toHaveBeenCalled();

    // The app's own page, and a caller with no Origin at all (a server), still report.
    const own = await report(
      integration,
      { key: "credits", quantity: 1, idempotencyKey: "own-1" },
      { "content-type": "application/json", origin: "http://example.com" },
    );
    expect(own.status).toBe(200);
    const server = await report(integration, {
      key: "credits",
      quantity: 1,
      idempotencyKey: "server-1",
    });
    expect(server.status).toBe(200);
  });

  it("takes requests from an origin listed in allowedOrigins", async () => {
    const sdk = createFakeSdk({
      id: "cus_1",
      balances: { credits: { usage: 0, granted: 100 } },
      subscriptions: [],
    });
    const integration = createIntegration(sdk, "app-user", ["https://app.example"]);
    const allowed = await report(
      integration,
      { key: "credits", quantity: 1, idempotencyKey: "app-1" },
      { "content-type": "application/json", origin: "https://app.example" },
    );
    expect(allowed.status).toBe(200);
  });
});

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
    expect(sdk.track).toHaveBeenCalledTimes(1);
    expect(sdk.track).toHaveBeenCalledWith(
      expect.objectContaining({
        featureId: "credits",
        value: 10,
        properties: { idempotencyKey: "evt-1" },
      }),
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
    expect(sdk.track).toHaveBeenCalledTimes(1);

    // A genuinely new event still applies.
    const second = await report(integration, {
      key: "credits",
      quantity: 5,
      idempotencyKey: "evt-2",
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ projectedCurrentPeriodUsed: 15 });
    expect(sdk.track).toHaveBeenCalledTimes(2);
    expect(sdk.track).toHaveBeenLastCalledWith(
      expect.objectContaining({ featureId: "credits", value: 5 }),
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
    expect(sdk.track).not.toHaveBeenCalled();
  });
  it.each([
    ["a negative quantity", -1_000_000],
    ["a small negative quantity", -1],
    ["zero", 0],
  ])("rejects %s without touching the provider balance", async (_label, quantity) => {
    const sdk = createFakeSdk({
      id: "cus_3",
      balances: { credits: { usage: 100, granted: 100 } },
      subscriptions: [],
    });
    const integration = createIntegration(sdk, "negative-user");

    // Usage is an increment, and the projection is written back as the
    // customer's absolute balance, so a negative quantity let a signed-in
    // customer lower or invert their own metered usage. The hard-limit guard
    // compares `projected > hardLimit`, which a negative always passes.
    const response = await report(integration, {
      key: "credits",
      quantity,
      idempotencyKey: `neg-${quantity}`,
    });

    expect(response.status).toBe(400);
    expect(sdk.track).not.toHaveBeenCalled();
  });

  it("still accepts an ordinary positive report", async () => {
    const sdk = createFakeSdk({
      id: "cus_4",
      balances: { credits: { usage: 0, granted: 100 } },
      subscriptions: [],
    });
    const integration = createIntegration(sdk, "positive-user");

    const response = await report(integration, {
      key: "credits",
      quantity: 10,
      idempotencyKey: "pos-1",
    });

    expect(response.status).toBe(200);
    expect(sdk.track).toHaveBeenCalled();
  });
});

describe("autumn usage-report idempotency under concurrent retries", () => {
  function deferred() {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    return { promise, resolve, reject };
  }

  it("applies a report once when a retry arrives while the first is in flight", async () => {
    const sdk = createFakeSdk({
      id: "cus_5",
      balances: { credits: { usage: 0, granted: 100 } },
      subscriptions: [],
    });
    const write = deferred();
    sdk.track.mockImplementation(async () => {
      await write.promise;
      return { value: 10, balance: null };
    });
    const integration = createIntegration(sdk, "concurrent-user");
    const body = { key: "credits", quantity: 10, idempotencyKey: "evt-concurrent" };

    const first = report(integration, body);
    const retry = report(integration, body);
    await vi.waitFor(() => expect(sdk.track).toHaveBeenCalledTimes(1));
    write.resolve();

    const [firstResponse, retryResponse] = await Promise.all([first, retry]);
    expect(firstResponse.status).toBe(200);
    expect(retryResponse.status).toBe(200);
    const firstBody = await firstResponse.json();
    expect(await retryResponse.json()).toEqual(firstBody);
    expect(firstBody).toMatchObject({ projectedCurrentPeriodUsed: 10 });
    expect(sdk.track).toHaveBeenCalledTimes(1);
  });

  it("lets a later retry apply a report whose in-flight attempt failed", async () => {
    const sdk = createFakeSdk({
      id: "cus_6",
      balances: { credits: { usage: 0, granted: 100 } },
      subscriptions: [],
    });
    const write = deferred();
    sdk.track.mockImplementationOnce(async () => {
      await write.promise;
      return { value: 10, balance: null };
    });
    const integration = createIntegration(sdk, "failed-user");
    const body = { key: "credits", quantity: 10, idempotencyKey: "evt-failed" };

    const first = report(integration, body);
    const concurrent = report(integration, body);
    await vi.waitFor(() => expect(sdk.track).toHaveBeenCalledTimes(1));
    write.reject(new Error("provider unavailable"));
    await expect(first).rejects.toThrow("provider unavailable");
    await expect(concurrent).rejects.toThrow("provider unavailable");

    const later = await report(integration, body);
    expect(later.status).toBe(200);
    expect(sdk.track).toHaveBeenCalledTimes(2);
  });
});

describe("autumn usage reports under concurrency", () => {
  // Autumn's model: `balances.update({ usage })` sets the stored usage, `track({ value })` adds to
  // it, and `customers.getOrCreate` reads whatever is stored when it runs.
  function createAutumnModel(granted: number) {
    let usage = 0;
    const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
    const sdk = createFakeSdk({});
    sdk.customers.getOrCreate.mockImplementation(async () => {
      const read = { id: "cus_race", balances: { credits: { usage, granted } }, subscriptions: [] };
      await tick();
      return read;
    });
    sdk.balances.update.mockImplementation(async (input?: { usage?: number }) => {
      await tick();
      usage = input?.usage ?? usage;
      return {};
    });
    sdk.track.mockImplementation(async (input: { value: number }) => {
      await tick();
      usage += input.value;
      return { value: input.value, balance: { usage, granted } as never };
    });
    return { sdk, usage: () => usage };
  }

  function reportAll(integration: ReturnType<typeof autumn>, count: number, quantity: number) {
    return Promise.all(
      Array.from({ length: count }, async (_, index) => {
        const response = await report(integration, {
          key: "credits",
          quantity,
          idempotencyKey: `race-${index}`,
        });
        expect(response.status).toBe(200);
        return ((await response.json()) as { state: string }).state;
      }),
    );
  }

  it("counts every parallel report instead of the last total written", async () => {
    const model = createAutumnModel(1_000_000);
    const integration = createIntegration(model.sdk as never, "race-user");

    await reportAll(integration, 20, 1000);

    expect(model.usage()).toBe(20_000);
    expect(model.sdk.balances.update).not.toHaveBeenCalled();
  });

  it("holds the hard cap when parallel reports race past it", async () => {
    const model = createAutumnModel(1_000_000);
    const integration = autumn({
      instance: model.sdk as unknown as AutumnIntegrationInstance,
      billing: {
        resolveOwner: () => ({ kind: "user" as const, id: "cap-user" }),
        meters: {
          credits: {
            aggregation: "sum" as const,
            featureId: "credits",
            guard: { hardLimit: 5000 },
          },
        },
      },
    });

    const states = await reportAll(integration, 20, 1000);

    expect(model.usage()).toBe(5000);
    expect(states.filter((state) => state === "hard_limit_reached")).toHaveLength(16);
  });
});

describe("autumn report-usage and prepaid quantities", () => {
  it("refuses to resize a prepaid quantity from a usage report", async () => {
    const sdk = createFakeSdk({
      id: "cus_prepaid",
      balances: { seats: { usage: 1, granted: 5 } },
      subscriptions: [
        {
          id: "sub_1",
          planId: "autumn_team",
          status: "active",
          pastDue: false,
          canceledAt: null,
          expiresAt: null,
          trialEndsAt: null,
          startedAt: Date.now() - 1000,
        },
      ],
      purchases: [],
    });
    sdk.plans.get.mockResolvedValue({
      id: "autumn_team",
      items: [
        {
          featureId: "seats",
          price: { amount: 10, interval: "month", billingMethod: "prepaid" },
        },
      ],
    } as never);
    const integration = autumn({
      instance: sdk as unknown as AutumnIntegrationInstance,
      billing: {
        resolveOwner: () => ({ kind: "user" as const, id: "prepaid-user" }),
        plans: { free: {}, team: {} },
        products: {
          team: { kind: "subscription", planId: "team", autumn: { planId: "autumn_team" } },
        },
        meters: { seats: { aggregation: "sum" as const, featureId: "seats" } },
      },
    });

    // Any signed-in caller could otherwise buy 500 seats, prorated and
    // charged at once, by reporting usage.
    const response = await report(integration, {
      key: "seats",
      quantity: 500,
      idempotencyKey: "seats-1",
    });

    expect(response.status).toBe(409);
    expect(await response.text()).toMatch(/prepaid quantity.*checkout/);
    expect(sdk.billing.update).not.toHaveBeenCalled();
    expect(sdk.track).not.toHaveBeenCalled();
  });
});
