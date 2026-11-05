// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClients } from "../api-client.native";

const SERVER_FETCH = Symbol.for("farm.native.serverFetch");
const routes = [{ path: "/api/notes", methods: ["GET", "POST"] }];

type Router = {
  notes: {
    get: () => Promise<Array<{ id: string; title: string }>>;
    post: (input: { body: { title: string } }) => Promise<{ id: string; title: string }>;
  };
};

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[SERVER_FETCH];
  vi.unstubAllGlobals();
});

describe("@farm.js/core/api/client on a native screen", () => {
  it("calls the app's API routes through serverFetch", async () => {
    // React Native has a `window` but no `location`.
    vi.stubGlobal("window", {});
    const serverFetch = vi.fn(async (_path: string, init?: RequestInit) =>
      Response.json(
        init?.method === "POST" ? { id: "7", title: "Creek" } : [{ id: "1", title: "Ridge" }],
      ),
    );
    (globalThis as Record<symbol, unknown>)[SERVER_FETCH] = serverFetch;
    const { apiClient } = createApiClients<Router>({ routes } as never);

    const list = (await apiClient.notes.get()) as unknown as { data: unknown };
    expect(list.data).toEqual([{ id: "1", title: "Ridge" }]);
    expect(serverFetch.mock.calls[0]![0]).toBe("/api/notes");

    const created = (await apiClient.notes.post({ body: { title: "Creek" } })) as unknown as {
      data: unknown;
    };
    expect(created.data).toEqual({ id: "7", title: "Creek" });
    const [path, init] = serverFetch.mock.calls[1]!;
    expect(path).toBe("/api/notes");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ title: "Creek" });
  });

  it("calls another server directly when given a baseURL", async () => {
    const serverFetch = vi.fn();
    (globalThis as Record<symbol, unknown>)[SERVER_FETCH] = serverFetch;
    const fetch = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetch);
    const { apiClient } = createApiClients<Router>({
      routes,
      baseURL: "https://api.example.com",
    } as never);
    await apiClient.notes.get();
    expect(serverFetch).not.toHaveBeenCalled();
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe("https://api.example.com/api/notes");
  });

  it("says how to fix a native bundle without @farm.js/native", async () => {
    const { apiClient } = createApiClients<Router>({ routes } as never);
    const result = (await apiClient.notes.get()) as unknown as { error: { message: string } };
    expect(result.error.message).toContain(
      "@farm.js/core/api/client needs @farm.js/native on a native screen",
    );
  });
});
