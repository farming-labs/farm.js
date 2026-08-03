/**
 * @vitest-environment jsdom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import {
  createServerFn,
  type InferServerFnError,
  type ServerActionError,
  type ServerFnFailure,
} from "../server-fn";
import { useServerFn, type UseServerFnReturn } from "../server-fn-client";

describe("useServerFn", () => {
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
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  it("tracks pending, result, and callbacks for imperative submissions", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onSuccess = vi.fn();
    const onSettled = vi.fn();
    const signup = createServerFn({
      input: z.object({
        email: z.string().email(),
      }),
      async handler({ input }) {
        await gate;
        return { ok: true as const, email: input.email };
      },
    });

    let action!: UseServerFnReturn<{ email: string }, { ok: true; email: string }>;

    function App() {
      action = useServerFn(signup, { onSuccess, onSettled });

      return createElement(
        "output",
        null,
        `${action.pending}:${action.status}:${action.result?.email ?? ""}:${action.error?.message ?? ""}`,
      );
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    expect(container.textContent).toBe("false:idle::");

    let promise!: Promise<{ ok: true; email: string }>;
    act(() => {
      promise = action.submit({ email: "ada@example.com" });
    });

    expect(container.textContent).toBe("true:pending::");

    await act(async () => {
      release();
      await promise;
    });

    expect(container.textContent).toBe("false:success:ada@example.com:");
    expect(onSuccess).toHaveBeenCalledWith({ ok: true, email: "ada@example.com" });
    expect(onSettled).toHaveBeenCalledWith({ ok: true, email: "ada@example.com" }, null);
  });

  it("accepts form actions and stores the returned result", async () => {
    const saveMessage = createServerFn({
      input: z.object({
        name: z.string().min(1),
        message: z.string().min(1),
      }),
      async handler({ input, formData }) {
        return {
          saved: true as const,
          name: input.name,
          message: input.message,
          hasFormData: formData instanceof FormData,
        };
      },
    });

    let action!: UseServerFnReturn<
      { name: string; message: string },
      { saved: true; name: string; message: string; hasFormData: boolean }
    >;

    function App() {
      action = useServerFn(saveMessage);
      return createElement("output", null, action.result?.name ?? action.status);
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    const formData = new FormData();
    formData.set("name", "Ada");
    formData.set("message", "Hello");

    await act(async () => {
      await action.formAction(formData);
    });

    expect(action.status).toBe("success");
    expect(action.result).toEqual({
      saved: true,
      name: "Ada",
      message: "Hello",
      hasFormData: true,
    });
    expect(container.textContent).toBe("Ada");
  });

  it("keeps form action errors in state without throwing by default", async () => {
    const handler = vi.fn();
    const onError = vi.fn();
    const signup = createServerFn({
      input: z.object({
        email: z.string().email(),
      }),
      handler,
    });

    let action!: UseServerFnReturn<{ email: string }, unknown>;

    function App() {
      action = useServerFn(signup, { onError });
      return createElement("output", null, action.status);
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    const formData = new FormData();
    formData.set("email", "not-an-email");

    await act(async () => {
      await expect(action.formAction(formData)).resolves.toBeUndefined();
    });

    expect(action.status).toBe("error");
    expect(action.error).toBeInstanceOf(Error);
    expect(handler).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(action.error);
  });

  it("applies optimistic results for form actions before the server settles", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saveMessage = createServerFn({
      input: z.object({
        message: z.string().min(1),
      }),
      async handler({ input }) {
        await gate;
        return {
          messages: [`Saved:${input.message}`],
        };
      },
    });

    let action!: UseServerFnReturn<{ message: string }, { messages: string[] }>;

    function App() {
      action = useServerFn(saveMessage, {
        initialResult: { messages: ["Existing"] },
        optimistic({ current, formData }) {
          return {
            messages: [
              ...(current?.messages ?? []),
              `Draft:${String(formData?.get("message") ?? "")}`,
            ],
          };
        },
      });

      return createElement("output", null, action.result?.messages.join("|") ?? action.status);
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    const formData = new FormData();
    formData.set("message", "Hello");

    let promise!: Promise<void>;
    await act(async () => {
      promise = action.formAction(formData);
      await Promise.resolve();
    });

    expect(container.textContent).toBe("Existing|Draft:Hello");

    await act(async () => {
      release();
      await promise;
    });

    expect(container.textContent).toBe("Saved:Hello");
  });

  it("rolls optimistic form results back when the server action fails", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saveMessage = createServerFn({
      input: z.object({
        message: z.string().min(1),
      }),
      async handler() {
        await gate;
        throw new Error("save failed");
      },
    });

    let action!: UseServerFnReturn<{ message: string }, { messages: string[] }>;

    function App() {
      action = useServerFn(saveMessage, {
        initialResult: { messages: ["Existing"] },
        rollbackOnError: true,
        optimistic({ current, formData }) {
          return {
            messages: [
              ...(current?.messages ?? []),
              `Draft:${String(formData?.get("message") ?? "")}`,
            ],
          };
        },
      });

      return createElement(
        "output",
        null,
        `${action.status}:${action.result?.messages.join("|") ?? ""}:${action.error?.message ?? ""}`,
      );
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    const formData = new FormData();
    formData.set("message", "Hello");

    let promise!: Promise<void>;
    await act(async () => {
      promise = action.formAction(formData);
      await Promise.resolve();
    });

    expect(container.textContent).toBe("pending:Existing|Draft:Hello:");

    await act(async () => {
      release();
      await promise;
    });

    expect(container.textContent).toBe("error:Existing:save failed");
  });

  it("resets action state and ignores stale submissions", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loadProfile = createServerFn({
      async handler() {
        await gate;
        return { name: "Ada" };
      },
    });

    let action!: UseServerFnReturn<unknown, { name: string }>;

    function App() {
      action = useServerFn(loadProfile, { initialResult: { name: "Grace" } });
      return createElement("output", null, `${action.status}:${action.result?.name ?? ""}`);
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    let promise!: Promise<{ name: string }>;
    act(() => {
      promise = action.submit();
    });

    expect(container.textContent).toBe("pending:");

    act(() => {
      action.reset();
    });

    expect(container.textContent).toBe("idle:Grace");

    await act(async () => {
      release();
      await promise;
    });

    expect(container.textContent).toBe("idle:Grace");
  });

  it("infers input and result types", () => {
    const signup = createServerFn({
      input: z.object({
        email: z.string().email(),
      }),
      async handler({ input }) {
        return { ok: true as const, email: input.email };
      },
    });

    function App() {
      const action = useServerFn(signup);

      expectTypeOf(action.submit).parameter(0).toEqualTypeOf<{ email: string } | FormData>();
      expectTypeOf(action.result).toEqualTypeOf<{ ok: true; email: string } | null>();
      expectTypeOf(action.error).toEqualTypeOf<Error | null>();

      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });
  });

  it("infers declared failures in client action state", async () => {
    const updateProduct = createServerFn({
      input: z.object({ id: z.string() }),
      errors: {
        NOT_FOUND: {
          status: 404,
          data: z.object({ id: z.string() }),
        },
      },
      handler({ input, error }) {
        if (input.id === "missing") return error("NOT_FOUND", { id: input.id });
        return { id: input.id, updated: true as const };
      },
    });
    type UpdateError = InferServerFnError<typeof updateProduct>;
    let action!: UseServerFnReturn<{ id: string }, { id: string; updated: true }, UpdateError>;

    function App() {
      action = useServerFn(updateProduct);
      expectTypeOf(action.error).toEqualTypeOf<
        ServerActionError | ServerFnFailure<"NOT_FOUND", { id: string }, 404> | null
      >();
      if (action.error?.name === "ServerFnFailure") {
        expectTypeOf(action.error.code).toEqualTypeOf<"NOT_FOUND">();
        expectTypeOf(action.error.data).toEqualTypeOf<{ id: string }>();
      }
      return createElement("output", null, action.error?.name ?? action.status);
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    await act(async () => {
      await expect(action.submit({ id: "missing" })).rejects.toMatchObject({
        name: "ServerFnFailure",
        code: "NOT_FOUND",
        status: 404,
        data: { id: "missing" },
      });
    });

    expect(container.textContent).toBe("ServerFnFailure");
  });
});
