import { describe, expect, it, vi } from "vitest";
import {
  createSearchClient,
  type PagefindBrowserApi,
  type PagefindBrowserModule,
} from "./client-runtime.js";
import type { FarmSearchPublicConfig } from "./types.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function config(bundlePath: string): FarmSearchPublicConfig {
  return { available: true, bundlePath, excerptLength: 30 } as FarmSearchPublicConfig;
}

function emptyResponse() {
  return {
    results: [],
    unfilteredResultCount: 0,
    filters: {},
    totalFilters: {},
    timings: { preload: 0, search: 0, total: 0 },
  };
}

/** A Pagefind stub whose search can be held open by the test. */
function createEngine(gate?: Promise<void>) {
  const api: PagefindBrowserApi = {
    options: vi.fn(async () => undefined),
    init: vi.fn(async () => undefined),
    search: vi.fn(async () => {
      if (gate) await gate;
      return emptyResponse();
    }),
    preload: vi.fn(async () => undefined),
    filters: vi.fn(async () => ({})),
    destroy: vi.fn(async () => undefined),
  };
  const module: PagefindBrowserModule = { ...api, createInstance: vi.fn(async () => api) };
  return { api, module };
}

describe("search client lifecycle races", () => {
  it("destroy() waits for an in-flight search before destroying the engine", async () => {
    const gate = deferred();
    const { api, module } = createEngine(gate.promise);
    const client = createSearchClient(
      () => config("/pagefind/"),
      {},
      vi.fn(async () => module),
    );

    const searching = client.search("docs");
    // Let the search reach the engine before destroying.
    await vi.waitFor(() => expect(api.search).toHaveBeenCalled());

    const destroying = client.destroy();
    // The engine must survive as long as the search is using it.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(api.destroy).not.toHaveBeenCalled();

    gate.resolve();
    await expect(searching).resolves.toMatchObject({ total: 0 });
    await destroying;
    expect(api.destroy).toHaveBeenCalledTimes(1);
  });

  it("a bundle-path change does not destroy the engine an earlier search is using", async () => {
    const gate = deferred();
    const first = createEngine(gate.promise);
    const second = createEngine();
    const loadModule = vi.fn(async (url: string) =>
      url.startsWith("/v1/") ? first.module : second.module,
    );

    let bundlePath = "/v1/";
    const client = createSearchClient(() => config(bundlePath), {}, loadModule);

    const searching = client.search("docs");
    await vi.waitFor(() => expect(first.api.search).toHaveBeenCalled());

    // The config flips while the first search is still running.
    bundlePath = "/v2/";
    await expect(client.filters()).resolves.toEqual({});
    expect(second.api.init).toHaveBeenCalled();
    expect(first.api.destroy).not.toHaveBeenCalled();

    gate.resolve();
    await expect(searching).resolves.toMatchObject({ total: 0 });
    // Only once the old engine drained is it destroyed.
    await vi.waitFor(() => expect(first.api.destroy).toHaveBeenCalledTimes(1));
  });

  it("a search issued after destroy() loads a fresh engine", async () => {
    const first = createEngine();
    const second = createEngine();
    const engines = [first, second];
    const loadModule = vi.fn(async () => engines.shift()!.module);
    const client = createSearchClient(() => config("/pagefind/"), {}, loadModule);

    await client.search("docs");
    await client.destroy();
    await expect(client.search("docs")).resolves.toMatchObject({ total: 0 });

    expect(loadModule).toHaveBeenCalledTimes(2);
    expect(first.api.destroy).toHaveBeenCalledTimes(1);
    expect(second.api.search).toHaveBeenCalledTimes(1);
  });

  it("destroy() is a no-op before anything loaded", async () => {
    const loadModule = vi.fn();
    const client = createSearchClient(() => config("/pagefind/"), {}, loadModule);
    await client.destroy();
    expect(loadModule).not.toHaveBeenCalled();
  });
});
