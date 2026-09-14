// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFetcher, FetcherInputError, type UseFetcherReturn } from "../fetcher-client";
import { createAPIClient } from "../api/client";

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

it.each(["form", "submit", "submitAsync"] as const)(
  "reports mapping errors through %s without calling the target",
  async (entry) => {
    const failure = new Error("Enter a valid quantity");
    const target = vi.fn(async (input: { quantity: number }) => input.quantity);
    const onError = vi.fn();
    const onSettled = vi.fn();
    const optimistic = vi.fn();
    let fetcher!: UseFetcherReturn<typeof target>;
    function View() {
      fetcher = useFetcher(target, {
        mapFormData() {
          throw failure;
        },
        onError,
        onSettled,
        optimistic,
      });
      return createElement(
        fetcher.Form,
        null,
        createElement("input", { name: "quantity", defaultValue: "invalid" }),
      );
    }
    await act(async () => root.render(createElement(View)));
    const Form = fetcher.Form;
    await act(async () => {
      if (entry === "form")
        container
          .querySelector("form")!
          .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      else if (entry === "submit") fetcher.submit(new FormData());
      else
        await expect(fetcher.submitAsync(new FormData())).rejects.toMatchObject({ cause: failure });
    });
    expect(target).not.toHaveBeenCalled();
    expect(optimistic).not.toHaveBeenCalled();
    expect(fetcher).toMatchObject({
      status: "error",
      error: { cause: failure },
      data: null,
      variables: undefined,
      pending: false,
      formData: null,
    });
    expect(fetcher.error).toBeInstanceOf(FetcherInputError);
    expect(onError).toHaveBeenCalledExactlyOnceWith(fetcher.error, undefined);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(null, fetcher.error, undefined);
    expect(fetcher.Form).toBe(Form);
  },
);

it("replaces previous success and keeps an older submission pending after validation fails", async () => {
  let finish!: (value: number) => void;
  const pending = new Promise<number>((resolve) => {
    finish = resolve;
  });
  const target = vi.fn(async (value: number) => (value === 2 ? pending : value));
  const failure = new Error("invalid");
  let fetcher!: UseFetcherReturn<typeof target>;
  const onSuccess = vi.fn();
  function View() {
    fetcher = useFetcher(target, {
      mapFormData() {
        throw failure;
      },
      onSuccess,
    });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  await act(async () => {
    await fetcher.submitAsync(1);
  });
  expect(fetcher.data).toBe(1);
  let older!: Promise<number>;
  await act(async () => {
    older = fetcher.submitAsync(2);
  });
  try {
    await act(async () => {
      fetcher.submit(new FormData());
    });
    expect(fetcher).toMatchObject({
      status: "error",
      data: null,
      error: { cause: failure },
      variables: undefined,
      pending: true,
    });
  } finally {
    await act(async () => {
      finish(2);
      await older;
    });
  }
  expect(fetcher).toMatchObject({
    status: "error",
    data: null,
    error: { cause: failure },
    pending: false,
  });
  expect(onSuccess).toHaveBeenCalledTimes(1);
  await act(async () => fetcher.reset());
  expect(fetcher).toMatchObject({ status: "idle", error: null, formData: null });
});

it("preserves data with resetOnMutate:false and normalizes non-Error mapping failures", async () => {
  const cause = { field: "quantity" };
  const target = vi.fn(async (value: number) => value);
  let fetcher!: UseFetcherReturn<typeof target>;
  function View() {
    fetcher = useFetcher(target, {
      resetOnMutate: false,
      mapFormData() {
        throw cause;
      },
    });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  await act(async () => {
    await fetcher.submitAsync(7);
  });
  await act(async () => {
    fetcher.submit(new FormData());
  });
  expect(fetcher).toMatchObject({ status: "error", data: 7, pending: false });
  expect(fetcher.error).toBeInstanceOf(Error);
  expect(fetcher.error).toMatchObject({ cause });
  expect(target).toHaveBeenCalledTimes(1);
});

it("keeps API input, optimistic variables and request options after successful preparation", async () => {
  type Router = {
    count: { post: { __types: { body: { count: number }; query: never; response: number } } };
  };
  const transport = vi.fn(async () => Response.json(4));
  const onRequest = vi.fn();
  const api = createAPIClient<Router>({ fetch: transport, baseURL: "https://farm.test" });
  const optimistic = vi.fn(
    ({ variables }: { variables: { body: { count: number } } | undefined }) =>
      variables?.body.count,
  );
  let fetcher!: UseFetcherReturn<typeof api.count.post>;
  function View() {
    fetcher = useFetcher(api.count.post, {
      mapFormData: (form) => ({ body: { count: Number(form.get("count")) } }),
      optimistic,
      request: { onRequest },
    });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  const form = new FormData();
  form.set("count", "4");
  await act(async () => {
    await expect(fetcher.submitAsync(form)).resolves.toBe(4);
  });
  expect(fetcher.variables).toEqual({ body: { count: 4 } });
  expect(optimistic).toHaveBeenCalledWith({ current: null, variables: { body: { count: 4 } } });
  expect(transport).toHaveBeenCalledWith(
    "https://farm.test/api/count",
    expect.objectContaining({ body: '{"count":4}' }),
  );
  expect(onRequest).toHaveBeenCalledOnce();
});

it("does not revive a submission when its mapper resets the fetcher before throwing", async () => {
  const target = vi.fn(async (value: number) => value);
  const onError = vi.fn();
  let fetcher!: UseFetcherReturn<typeof target>;
  function View() {
    fetcher = useFetcher(target, {
      onError,
      mapFormData() {
        fetcher.reset();
        throw new Error("reset mapper");
      },
    });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  await act(async () => {
    fetcher.submit(new FormData());
  });
  expect(fetcher).toMatchObject({ status: "idle", error: null, pending: false });
  expect(target).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

it("distinguishes a local API form error without dispatching HTTP", async () => {
  type Router = {
    count: {
      post: {
        __types: {
          body: { count: number };
          query: never;
          response: number;
          errors: { INVALID: { data: { minimum: number }; status: 422 } };
        };
      };
    };
  };
  const transport = vi.fn(async () => Response.json(4));
  const api = createAPIClient<Router>({ fetch: transport, baseURL: "https://farm.test" });
  const requestError = vi.fn();
  const failure = new Error("Please enter a count");
  let fetcher!: UseFetcherReturn<typeof api.count.post>;
  function View() {
    fetcher = useFetcher(api.count.post, {
      mapFormData() {
        throw failure;
      },
      request: { onError: requestError },
    });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  await act(async () => {
    fetcher.submit(new FormData());
  });
  expect(fetcher.error).toBeInstanceOf(FetcherInputError);
  expect(fetcher.error).toMatchObject({
    code: "input_error",
    status: 0,
    data: undefined,
    message: failure.message,
    cause: failure,
  });
  expect(transport).not.toHaveBeenCalled();
  expect(requestError).not.toHaveBeenCalled();
});

it("preserves a newer submission started inside a failing mapper", async () => {
  let finish!: (value: number) => void;
  const pending = new Promise<number>((resolve) => {
    finish = resolve;
  });
  const target = vi.fn(async (_value: number) => pending);
  const onError = vi.fn();
  let fetcher!: UseFetcherReturn<typeof target>;
  let next: Promise<number> | undefined;
  function View() {
    fetcher = useFetcher(target, {
      onError,
      mapFormData() {
        next = fetcher.submitAsync(5);
        throw new Error("old mapping failed");
      },
    });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  try {
    await act(async () => {
      fetcher.submit(new FormData());
    });
    expect(fetcher).toMatchObject({ pending: true, status: "pending", error: null, variables: 5 });
    expect(onError).not.toHaveBeenCalled();
    expect(target).toHaveBeenCalledExactlyOnceWith(5);
  } finally {
    await act(async () => {
      finish(5);
      await next;
    });
  }
  expect(fetcher).toMatchObject({ pending: false, status: "success", data: 5 });
});
