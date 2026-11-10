// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { FarmIntegrationHandlerContext } from "../integrations";
import {
  autumn,
  legacyAutumnExternalCustomerId,
  type AutumnIntegrationInstance,
} from "../../../farm-integrations/src/autumn/index";

function createContext(request: Request, instance: unknown): FarmIntegrationHandlerContext {
  const req = {
    get: () => undefined,
    set() {},
    has: () => false,
    delete: () => false,
    clear() {},
    snapshot: () => new Map<string, unknown>(),
  };
  return {
    request,
    requestId: "req_test",
    url: new URL(request.url),
    pathname: new URL(request.url).pathname,
    method: "GET",
    params: {},
    input: {},
    data: {},
    integration: { category: "payment", slot: "payment", type: "autumn", instance },
    route: { kind: "route", path: "/billing/status", methods: ["GET"] },
    req,
    requestContext: req,
    config: {} as FarmIntegrationHandlerContext["config"],
    isDev: true,
    isProd: false,
  };
}

/** The Autumn customer id Farm derives for an owner id. */
async function customerIdFor(ownerId: string, kind: "user" | "organization" = "user") {
  const getOrCreate = vi.fn(async ({ customerId }: { customerId: string }) => ({
    id: customerId,
    subscriptions: [],
    purchases: [],
    balances: {},
  }));
  const integration = autumn({
    instance: {
      customers: { getOrCreate },
      plans: { get: vi.fn(), list: vi.fn(async () => ({ list: [] })) },
    } as unknown as AutumnIntegrationInstance,
    billing: { resolveOwner: () => ({ kind, id: ownerId }) },
  });
  const route = integration.routes.find(
    (candidate) => candidate.path === "/billing/status" && candidate.method === "GET",
  )!;
  const request = new Request("http://example.com/billing/status");
  await route.handler(request, createContext(request, integration.instance));
  return getOrCreate.mock.calls[0]![0].customerId;
}

describe("autumn external customer ids", () => {
  it("keeps the id of an owner whose id is already safe", async () => {
    await expect(customerIdFor("kp_2b9c4F_x-1")).resolves.toBe("user_kp_2b9c4F_x-1");
    await expect(customerIdFor("org_1", "organization")).resolves.toBe("organization_org_1");
  });

  it("gives owners that used to collide their own customers", async () => {
    const ids = await Promise.all(
      ["a.b", "a-b", "a b", "-a-b-", "", "用户", "ユーザー", "a@example.com", "a_example.com"].map(
        (id) => customerIdFor(id),
      ),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[1]).toBe("user_a-b");
    // Autumn customer ids stay within the characters the default always produced.
    for (const id of ids) expect(id).toMatch(/^user_[A-Za-z0-9_-]+$/);
  });

  it("keeps the previous mapping available for migrations", () => {
    expect(legacyAutumnExternalCustomerId({ kind: "user", id: "a.b" })).toBe("user_a-b");
    expect(legacyAutumnExternalCustomerId({ kind: "user", id: "用户" })).toBe("user_unknown");
  });
});
