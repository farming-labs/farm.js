/**
 * @vitest-environment jsdom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { createAPIClient } from "../api/client";
import { useFetcher, type UseFetcherReturn } from "../fetcher-client";
import { createServerFn } from "../server-fn";

type APIRouter = {
  products: {
    post: {
      __types: {
        body: { name: string; intent?: string };
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

describe("useFetcher", () => {
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

  it("submits a generated API form without navigating and exposes its lifecycle", async () => {
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
    let fetcher!: UseFetcherReturn<typeof api.products.post>;

    function App() {
      fetcher = useFetcher(api.products.post);
      return createElement(
        fetcher.Form,
        { "data-state": fetcher.state },
        createElement("input", { name: "name", defaultValue: "Strata" }),
        createElement("button", { name: "intent", value: "create", type: "submit" }, "Create"),
        createElement("output", null, fetcher.data?.name ?? fetcher.status),
      );
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    const form = container.querySelector("form")!;
    expect(form.action).toBe("https://farm.test/api/products");
    expect(form.method).toBe("post");

    await act(async () => {
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(form.dataset.state).toBe("submitting");
    expect(fetcher.formData?.get("name")).toBe("Strata");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://farm.test/api/products",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Strata" }),
      }),
    );

    response.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ id: "product-1", name: "Strata" }),
    });

    await act(async () => {
      await response.promise;
      await Promise.resolve();
    });

    expect(form.dataset.state).toBe("idle");
    expect(fetcher.formData).toBeNull();
    expect(container.querySelector("output")?.textContent).toBe("Strata");
  });

  it("uses a relative native action for same-origin API clients", () => {
    const api = createAPIClient<APIRouter>();

    function App() {
      const fetcher = useFetcher(api.products.post);
      return createElement(fetcher.Form);
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    const form = container.querySelector("form")!;
    expect(form.getAttribute("action")).toBe("/api/products");
    expect(form.method).toBe("post");
  });

  it("keeps a server function as the native form action and submits FormData", async () => {
    const save = createServerFn({
      input: z.object({
        name: z.string().min(1),
      }),
      async handler({ input, formData }) {
        return {
          name: input.name,
          receivedFormData: formData instanceof FormData,
        };
      },
    });
    let fetcher!: UseFetcherReturn<typeof save>;

    function App() {
      fetcher = useFetcher(save);
      return createElement(
        fetcher.Form,
        null,
        createElement("input", { name: "name", defaultValue: "Ada" }),
        createElement("button", { type: "submit" }, "Save"),
      );
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(fetcher.data).toEqual({
      name: "Ada",
      receivedFormData: true,
    });
    expectTypeOf(fetcher.data).toEqualTypeOf<{
      name: string;
      receivedFormData: boolean;
    } | null>();
  });

  it("maps form values into typed variables when a route needs custom input", async () => {
    const target = vi.fn(async (input: { count: number }) => ({ doubled: input.count * 2 }));
    let fetcher!: UseFetcherReturn<typeof target>;

    function App() {
      fetcher = useFetcher(target, {
        mapFormData(formData, context) {
          expect(context.form).toBeInstanceOf(HTMLFormElement);
          return { count: Number(formData.get("count")) };
        },
      });
      return createElement(
        fetcher.Form,
        null,
        createElement("input", { name: "count", defaultValue: "4" }),
        createElement("button", { type: "submit" }, "Double"),
      );
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(target).toHaveBeenCalledWith({ count: 4 });
    expect(fetcher.data).toEqual({ doubled: 8 });
  });
});
