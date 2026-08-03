/**
 * @vitest-environment jsdom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { createAPIClient } from "../api/client";
import { useMutation, type UseMutationReturn } from "../mutation-client";
import { createServerFn } from "../server-fn";

type APIRouter = {
  products: {
    post: {
      __types: {
        body: { name: string };
        query: never;
        response: { id: string; name: string };
      };
    };
  };
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("useMutation", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    (globalThis as any).window = globalThis;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container.remove();
    root = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  it("unwraps generated API route results and tracks their lifecycle", async () => {
    const response = createDeferred<{
      ok: boolean;
      status: number;
      statusText: string;
      json: () => Promise<{ id: string; name: string }>;
    }>();
    globalThis.fetch = vi.fn(() => response.promise) as any;
    const api = createAPIClient<APIRouter>({
      baseURL: "https://farm.test",
    });

    let mutation!: UseMutationReturn<typeof api.products.post, { id: string; name: string }>;

    function App() {
      mutation = useMutation(api.products.post);
      return createElement("output", null, `${mutation.status}:${mutation.data?.name ?? ""}`);
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    let result!: Promise<{ id: string; name: string }>;
    act(() => {
      result = mutation.mutateAsync({ body: { name: "Strata" } });
    });

    expect(container.textContent).toBe("pending:");
    response.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ id: "p1", name: "Strata" }),
    });

    await act(async () => {
      await expect(result).resolves.toEqual({
        id: "p1",
        name: "Strata",
      });
    });

    expect(container.textContent).toBe("success:Strata");
    expectTypeOf(mutation.data).toEqualTypeOf<{
      id: string;
      name: string;
    } | null>();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://farm.test/api/products",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Strata" }),
      }),
    );
  });

  it("uses the same lifecycle for server functions", async () => {
    const rename = createServerFn({
      input: z.object({ name: z.string() }),
      async handler({ input }) {
        return { saved: input.name };
      },
    });
    let mutation!: UseMutationReturn<typeof rename>;

    function App() {
      mutation = useMutation(rename);
      return createElement("output", null, `${mutation.status}:${mutation.data?.saved ?? ""}`);
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    await act(async () => {
      await mutation.mutateAsync({ name: "Farm" });
    });

    expect(container.textContent).toBe("success:Farm");
  });

  it("infers declared server function failures", () => {
    const removeProduct = createServerFn({
      input: z.object({ id: z.string() }),
      errors: {
        NOT_FOUND: {
          status: 404,
          data: z.object({ id: z.string() }),
        },
      },
      handler: ({ input, error }) => error("NOT_FOUND", { id: input.id }),
    });

    function App() {
      const mutation = useMutation(removeProduct);
      if (mutation.error?.name === "ServerFnFailure") {
        expectTypeOf(mutation.error.code).toEqualTypeOf<"NOT_FOUND">();
        expectTypeOf(mutation.error.data).toEqualTypeOf<{ id: string }>();
        expectTypeOf(mutation.error.status).toEqualTypeOf<404>();
      }
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });
  });

  it("keeps the latest result after an older concurrent request settles", async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const save = vi
      .fn<(value: string) => Promise<string>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    let mutation!: UseMutationReturn<typeof save>;

    function App() {
      mutation = useMutation(save);
      return createElement(
        "output",
        null,
        `${mutation.status}:${mutation.pending}:${mutation.data ?? ""}`,
      );
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    let older!: Promise<string>;
    let latest!: Promise<string>;
    act(() => {
      older = mutation.mutateAsync("older");
      latest = mutation.mutateAsync("latest");
    });

    second.resolve("latest");
    await act(async () => {
      await latest;
    });
    expect(container.textContent).toBe("success:true:latest");

    first.resolve("older");
    await act(async () => {
      await older;
    });
    expect(container.textContent).toBe("success:false:latest");
  });

  it("rolls back local optimistic data after API errors", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({ message: "Already exists" }),
    })) as any;
    const api = createAPIClient<APIRouter>({
      baseURL: "https://farm.test",
    });
    let mutation!: UseMutationReturn<typeof api.products.post>;

    function App() {
      mutation = useMutation(api.products.post, {
        initialData: { id: "existing", name: "Existing" },
        optimistic: ({ variables }) => ({
          id: "optimistic",
          name: variables?.body.name ?? "",
        }),
        rollbackOnError: true,
      });
      return createElement("output", null, `${mutation.status}:${mutation.data?.name ?? ""}`);
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    await act(async () => {
      await expect(mutation.mutateAsync({ body: { name: "Existing" } })).rejects.toThrow(
        "HTTP 409: Conflict",
      );
    });

    expect(container.textContent).toBe("error:Existing");
  });
});
