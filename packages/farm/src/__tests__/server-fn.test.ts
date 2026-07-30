// @vitest-environment node

import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { createServerFn, createServerMiddleware, FARM_SERVER_FN_SYMBOL } from "../server-fn";
import {
  getServerActionInvalidations,
  runWithServerActionRequest,
} from "../server-action-security";
import { _runWithCurrentRequest } from "../server/request";
import {
  createFarmCacheKey,
  createRouteDataCacheKey,
  createRouteDataCacheTag,
  getFarmDataCache,
} from "../cache";

describe("createServerFn", () => {
  afterEach(() => {
    getFarmDataCache().clear();
  });

  it("validates object input before calling the handler", async () => {
    const handler = vi.fn(async ({ input }: { input: { email: string; password: string } }) => ({
      ok: true,
      email: input.email,
    }));

    const signup = createServerFn({
      input: z.object({
        email: z.string().email(),
        password: z.string().min(8),
      }),
      handler,
    });

    const result = await signup({
      email: "ada@example.com",
      password: "correct horse battery staple",
    });

    expect(result).toEqual({ ok: true, email: "ada@example.com" });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          email: "ada@example.com",
          password: "correct horse battery staple",
        },
      }),
    );
    expect(
      (signup as unknown as Record<typeof FARM_SERVER_FN_SYMBOL, boolean>)[FARM_SERVER_FN_SYMBOL],
    ).toBe(true);
  });

  it("turns form data into schema input for form actions", async () => {
    const submitMessage = createServerFn({
      input: z.object({
        name: z.string().min(1),
        message: z.string().min(1),
      }),
      async handler({ input, formData }) {
        return {
          saved: true,
          name: input.name,
          message: input.message,
          hasFormData: formData instanceof FormData,
        };
      },
    });

    const formData = new FormData();
    formData.set("name", "Ada");
    formData.set("message", "Hello from a form");

    await expect(submitMessage(formData)).resolves.toEqual({
      saved: true,
      name: "Ada",
      message: "Hello from a form",
      hasFormData: true,
    });
  });

  it("does not call the handler when validation fails", async () => {
    const handler = vi.fn();
    const signup = createServerFn({
      input: z.object({
        email: z.string().email(),
      }),
      handler,
    });

    await expect(signup({ email: "nope" })).rejects.toBeTruthy();
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps repeated form fields as arrays and drops unsafe metadata keys", async () => {
    const inspect = createServerFn({
      handler({ input }) {
        const data = input as Record<string, unknown>;

        return {
          tags: data.tag,
          actionMetadataPresent: Object.prototype.hasOwnProperty.call(data, "$ACTION_ID_123"),
          protoPresent: Object.prototype.hasOwnProperty.call(data, "__proto__"),
          constructorPresent: Object.prototype.hasOwnProperty.call(data, "constructor"),
          polluted: ({} as Record<string, unknown>).polluted,
        };
      },
    });

    const formData = new FormData();
    formData.append("tag", "rsc");
    formData.append("tag", "forms");
    formData.append("$ACTION_ID_123", "secret-action-ref");
    formData.append("__proto__", "polluted");
    formData.append("constructor", "polluted");

    await expect(inspect(formData)).resolves.toEqual({
      tags: ["rsc", "forms"],
      actionMetadataPresent: false,
      protoPresent: false,
      constructorPresent: false,
      polluted: undefined,
    });
  });

  it("allows input-less server functions to be called without an argument", async () => {
    const getMessages = createServerFn({
      async handler() {
        return ["hello"];
      },
    });

    await expect(getMessages()).resolves.toEqual(["hello"]);
    expectTypeOf(getMessages).parameter(0).toEqualTypeOf<unknown | FormData | undefined>();
  });

  it("infers input and response types from the schema and handler", async () => {
    const signup = createServerFn({
      input: z.object({
        email: z.string().email(),
      }),
      async handler({ input }) {
        expectTypeOf(input.email).toEqualTypeOf<string>();
        return { ok: true as const };
      },
    });

    expectTypeOf(signup).parameter(0).toEqualTypeOf<{ email: string } | FormData>();
    expectTypeOf(await signup({ email: "ada@example.com" })).toEqualTypeOf<{ ok: true }>();
  });

  it("validates and filters handler results with an output schema", async () => {
    const publicUserSchema = z.object({
      id: z.string(),
      email: z.string().email(),
    });
    const getUser = createServerFn({
      input: z.object({ id: z.string() }),
      output: publicUserSchema,
      async handler({ input }) {
        const databaseUser = {
          id: input.id,
          email: "ada@example.com",
          passwordHash: "must-not-cross-the-action-boundary",
        };

        return databaseUser;
      },
    });

    const result = await getUser({ id: "user-1" });

    expect(result).toEqual({ id: "user-1", email: "ada@example.com" });
    expect(result).not.toHaveProperty("passwordHash");
    expectTypeOf(result).toEqualTypeOf<{ id: string; email: string }>();
    expect(getUser.__farmServerFnOutput).toBe(publicUserSchema);
    expect(Object.keys(getUser)).not.toContain("__farmServerFnOutput");
  });

  it("returns the transformed output type from asynchronous handlers", async () => {
    const formatCount = createServerFn({
      input: z.object({ count: z.number().int() }),
      output: z.object({ count: z.number() }).transform(({ count }) => `count:${count}`),
      async handler({ input }) {
        expectTypeOf(input).toEqualTypeOf<{ count: number }>();
        return { count: input.count };
      },
    });

    expectTypeOf(formatCount).parameter(0).toEqualTypeOf<{ count: number } | FormData>();
    const result = await formatCount({ count: 3 });
    expect(result).toBe("count:3");
    expectTypeOf(result).toEqualTypeOf<string>();
  });

  it("rejects results that fail the output contract", async () => {
    const getProfile = createServerFn({
      output: z.object({ displayName: z.string().min(1) }),
      handler() {
        return { displayName: 42 } as unknown as { displayName: string };
      },
    });

    await expect(getProfile()).rejects.toBeTruthy();
  });

  it("reports invalid output parser contracts precisely", async () => {
    const invalidOutput = {} as {
      _input: { ok: boolean };
      _output: { ok: boolean };
    };
    const action = createServerFn({
      output: invalidOutput,
      handler() {
        return { ok: true };
      },
    });

    await expect(action()).rejects.toThrow(
      "createServerFn output must provide parse, parseAsync, or safeParse",
    );
  });

  it("provides the action request and cancellation signal to handlers", async () => {
    const controller = new AbortController();
    const request = new Request("https://app.example.com/action", {
      signal: controller.signal,
    });
    const inspect = createServerFn({
      handler({ request: currentRequest, signal }) {
        return {
          request: currentRequest,
          signal,
        };
      },
    });

    const result = await runWithServerActionRequest(request, () => inspect());

    expect(result.request).toBe(request);
    expect(result.signal).toBe(request.signal);
    controller.abort();
    expect(result.signal.aborted).toBe(true);
  });

  it("composes middleware dependencies with typed server context", async () => {
    const trace: string[] = [];
    const requireUser = createServerMiddleware({
      async handler({ request, signal, next }) {
        trace.push("auth:before");
        expect(request?.headers.get("x-user-id")).toBe("user-1");
        expect(signal).toBe(request?.signal);

        const result = await next({
          context: {
            user: {
              id: request!.headers.get("x-user-id")!,
              role: "admin" as const,
            },
          },
        });
        trace.push("auth:after");
        return result;
      },
    });
    const requireAdmin = createServerMiddleware({
      middleware: [requireUser],
      async handler({ context, next }) {
        expectTypeOf(context.user).toEqualTypeOf<{
          id: string;
          role: "admin";
        }>();
        trace.push("admin:before");
        const result = await next({ context: { permission: "products:write" as const } });
        trace.push("admin:after");
        return result;
      },
    });
    const audit = createServerMiddleware({
      middleware: [requireUser],
      async handler({ context, next }) {
        expectTypeOf(context.user.id).toEqualTypeOf<string>();
        trace.push(`audit:${context.user.id}:before`);
        const result = await next();
        trace.push(`audit:${context.user.id}:after`);
        return result;
      },
    });
    const updateProduct = createServerFn({
      middleware: [requireAdmin, audit],
      input: z.object({ id: z.string() }),
      async handler({ input, context }) {
        expectTypeOf(context.permission).toEqualTypeOf<"products:write">();
        expectTypeOf(context.user.role).toEqualTypeOf<"admin">();
        trace.push("handler");
        return {
          id: input.id,
          userId: context.user.id,
          permission: context.permission,
        };
      },
    });
    const request = new Request("https://app.example.com/actions/update-product", {
      headers: { "x-user-id": "user-1" },
    });

    const result = await runWithServerActionRequest(request, () =>
      updateProduct({ id: "product-1" }),
    );

    expect(result).toEqual({
      id: "product-1",
      userId: "user-1",
      permission: "products:write",
    });
    expect(trace).toEqual([
      "auth:before",
      "admin:before",
      "audit:user-1:before",
      "handler",
      "audit:user-1:after",
      "admin:after",
      "auth:after",
    ]);
  });

  it("uses the current render request for direct server calls", async () => {
    const request = new Request("https://app.example.com/dashboard", {
      headers: { "x-tenant": "acme" },
    });
    const tenant = createServerMiddleware({
      handler({ request: currentRequest, next }) {
        return next({
          context: { tenant: currentRequest?.headers.get("x-tenant") ?? "public" },
        });
      },
    });
    const inspect = createServerFn({
      middleware: [tenant],
      handler({ request: currentRequest, context, signal }) {
        return {
          request: currentRequest,
          tenant: context.tenant,
          signal,
        };
      },
    });

    const result = await _runWithCurrentRequest(request, () => inspect());

    expect(result.request).toBe(request);
    expect(result.tenant).toBe("acme");
    expect(result.signal).toBe(request.signal);
  });

  it("applies declared cache invalidations after successful output validation", async () => {
    const productKey = ["product", "product-1"] as const;
    const productCacheKey = createFarmCacheKey(["route-data", productKey]);
    const productsPageKey = "products-page";
    const cache = getFarmDataCache();
    cache.set(
      productCacheKey,
      { id: "product-1", name: "Old" },
      {
        tags: [createRouteDataCacheTag(productKey), "products"],
      },
    );
    cache.set(productsPageKey, "<html>old</html>", {
      paths: ["/products/product-1"],
    });
    const addTenant = createServerMiddleware({
      handler({ next }) {
        return next({ context: { tenantId: "tenant-1" } });
      },
    });
    const updateProduct = createServerFn({
      input: z.object({ id: z.string(), name: z.string() }),
      output: z.object({ id: z.string(), name: z.string() }),
      middleware: [addTenant],
      invalidates: ({ input, result, context }) => {
        expectTypeOf(input).toEqualTypeOf<{ id: string; name: string }>();
        expectTypeOf(result).toEqualTypeOf<{ id: string; name: string }>();
        expectTypeOf(context.tenantId).toEqualTypeOf<string>();
        expect(context.tenantId).toBe("tenant-1");
        return [
          { key: ["product", input.id] },
          { path: `/products/${result.id}` },
          { tag: "products" },
        ];
      },
      handler: async ({ input }) => input,
    });
    const request = new Request("https://app.example.com/actions/update-product", {
      method: "POST",
    });

    const actionResult = await runWithServerActionRequest(request, () =>
      updateProduct({ id: "product-1", name: "New" }),
    );

    expect(actionResult).toEqual({ id: "product-1", name: "New" });
    expect(cache.getEntry(productCacheKey)).toBeUndefined();
    expect(cache.getEntry(productsPageKey)).toBeUndefined();
    const invalidations = await runWithServerActionRequest(request, async () => {
      await updateProduct({ id: "product-1", name: "Newest" });
      return getServerActionInvalidations();
    });
    expect(invalidations).toContain(createRouteDataCacheKey(productKey));
  });

  it("does not apply declared invalidations when the handler or output contract fails", async () => {
    const key = ["products", "list"] as const;
    const cacheKey = createFarmCacheKey(["route-data", key]);
    const cache = getFarmDataCache();
    cache.set(cacheKey, [{ id: "old" }], {
      tags: [createRouteDataCacheTag(key)],
    });
    const handlerFailure = createServerFn({
      invalidates: [{ key }],
      handler() {
        throw new Error("write failed");
      },
    });
    const outputFailure = createServerFn({
      output: z.object({ ok: z.literal(true) }),
      invalidates: [{ key }],
      handler: () => ({ ok: false }),
    });

    await expect(handlerFailure()).rejects.toThrow("write failed");
    expect(cache.getEntry(cacheKey)?.value).toEqual([{ id: "old" }]);
    await expect(outputFailure()).rejects.toBeTruthy();
    expect(cache.getEntry(cacheKey)?.value).toEqual([{ id: "old" }]);
  });

  it("rejects middleware that skips or calls next more than once", async () => {
    const skipsNext = createServerMiddleware({
      handler: (() => Promise.resolve({ ok: false })) as any,
    });
    const callsNextTwice = createServerMiddleware({
      async handler({ next }) {
        await next();
        return next();
      },
    });
    const skipped = createServerFn({
      middleware: [skipsNext],
      handler: () => ({ ok: true }),
    });
    const repeated = createServerFn({
      middleware: [callsNextTwice],
      handler: () => ({ ok: true }),
    });

    await expect(skipped()).rejects.toThrow("Server function middleware must call next()");
    await expect(repeated()).rejects.toThrow(
      "Server function middleware next() can only be called once",
    );
  });
});
