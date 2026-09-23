import { describe, expect, it, vi } from "vitest";
import { createFederationClient, type FederationRuntimeApi } from "./client-runtime";

function runtime(overrides: Partial<FederationRuntimeApi> = {}): FederationRuntimeApi {
  return {
    loadRemote: vi.fn(async () => ({ default: "remote" })) as FederationRuntimeApi["loadRemote"],
    preloadRemote: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("federation browser client", () => {
  it("loads typed modules and reuses the runtime", async () => {
    const api = runtime();
    const loader = vi.fn(async () => api);
    const client = createFederationClient(loader, () => true);

    await expect(client.loadRemote<{ default: string }>("checkout/Button")).resolves.toEqual({
      default: "remote",
    });
    await client.loadRemote("checkout/Summary");

    expect(loader).toHaveBeenCalledOnce();
    expect(api.loadRemote).toHaveBeenNthCalledWith(1, "checkout/Button");
  });

  it("preloads one or more configured producers", async () => {
    const api = runtime();
    const client = createFederationClient(
      async () => api,
      () => true,
    );

    await client.preloadRemote(["checkout", "catalog"]);
    expect(api.preloadRemote).toHaveBeenCalledWith([
      { nameOrAlias: "checkout" },
      { nameOrAlias: "catalog" },
    ]);
  });

  it("fails before loading runtime code during SSR", async () => {
    const loader = vi.fn(async () => runtime());
    const client = createFederationClient(loader, () => false);

    await expect(client.loadRemote("checkout/Button")).rejects.toThrow("after hydration");
    expect(loader).not.toHaveBeenCalled();
  });

  it("reports missing modules and validates specifiers", async () => {
    const api = runtime({
      loadRemote: vi.fn(async () => null) as FederationRuntimeApi["loadRemote"],
    });
    const client = createFederationClient(
      async () => api,
      () => true,
    );

    await expect(client.loadRemote("checkout/Missing")).rejects.toThrow("was not found");
    await expect(client.loadRemote("checkout")).rejects.toThrow("remote and exposed module");
    await expect(client.preloadRemote([])).rejects.toThrow("at least one remote");
  });

  it("retries runtime loading after a transient failure", async () => {
    const api = runtime();
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValue(api);
    const client = createFederationClient(loader, () => true);

    await expect(client.loadRemote("checkout/Button")).rejects.toThrow("network unavailable");
    await expect(client.loadRemote("checkout/Button")).resolves.toEqual({ default: "remote" });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
