// @vitest-environment node

import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { createEndpoint } from "../api/endpoint";
import { redirect } from "../navigation";
import { api, createRoute } from "../routes";
import { createServerFn } from "../server-fn";
import { createFarmTestHarness, createTestRequest } from "../testing";

afterEach(() => {
  createFarmTestHarness().clearCache();
});

describe("createTestRequest", () => {
  it("builds JSON requests with query, header, and cookie defaults", async () => {
    const farm = createFarmTestHarness({
      origin: "https://app.example.com/base",
      headers: { "x-tenant": "acme", "x-shared": "default" },
      cookies: { session: "session value" },
    });

    const request = farm.request("/api/products?keep=old", {
      query: {
        keep: "new",
        tag: ["rsc", "forms"],
        preview: true,
        skipped: undefined,
      },
      headers: { "x-shared": "request" },
      cookies: { theme: "dark" },
      json: { name: "Farm" },
    });
    const url = new URL(request.url);

    expect(request.method).toBe("POST");
    expect(url.origin).toBe("https://app.example.com");
    expect(url.pathname).toBe("/api/products");
    expect(url.searchParams.get("keep")).toBe("new");
    expect(url.searchParams.getAll("tag")).toEqual(["rsc", "forms"]);
    expect(url.searchParams.get("preview")).toBe("true");
    expect(url.searchParams.has("skipped")).toBe(false);
    expect(request.headers.get("x-tenant")).toBe("acme");
    expect(request.headers.get("x-shared")).toBe("request");
    expect(request.headers.get("cookie")).toBe("session=session%20value; theme=dark");
    expect(request.headers.get("content-type")).toBe("application/json");
    await expect(request.json()).resolves.toEqual({ name: "Farm" });
  });

  it("builds repeated form fields", async () => {
    const request = createTestRequest("/contact", {
      form: {
        name: "Ada",
        topic: ["routing", "testing"],
      },
    });
    const formData = await request.formData();

    expect(request.method).toBe("POST");
    expect(formData.get("name")).toBe("Ada");
    expect(formData.getAll("topic")).toEqual(["routing", "testing"]);
  });

  it("rejects ambiguous bodies, GET bodies, and invalid origins", () => {
    expect(() =>
      createTestRequest("/submit", {
        json: { ok: true },
        body: "duplicate",
      }),
    ).toThrow("only one of json, form, or body");

    expect(() =>
      createTestRequest("/submit", {
        method: "GET",
        json: { ok: true },
      }),
    ).toThrow("cannot send a body with GET");

    expect(() => createTestRequest("/", { origin: "file:///tmp/farm" })).toThrow(
      "must use HTTP(S)",
    );
  });
});

describe("Farm test route harness", () => {
  it("runs typed schemas, context, guards, and data hooks in runtime order", async () => {
    const events: string[] = [];
    const contextFactory = vi.fn(({ request, params, search }) => ({
      tenant: request.headers.get("x-tenant"),
      routeId: params.id,
      rawTab: search.tab,
    }));
    const farm = createFarmTestHarness({
      origin: "https://shop.example.com",
      headers: { "x-tenant": "tenant-1" },
      context: contextFactory,
    });

    const ProductRoute = createRoute("/products/[id]", {
      params: z.object({ id: z.string().min(1) }),
      search: {
        schema: z.object({
          tab: z.enum(["info", "reviews"]).default("info"),
          locale: z.string().default("en"),
          toast: z.string().optional(),
        }),
        stripDefaults: true,
        preserve: ["locale"],
        temporary: ["toast"],
      },
      guard({ context }) {
        events.push("guard");
        expect((context as { tenant: string }).tenant).toBe("tenant-1");
      },
      data: {
        before({ params }) {
          events.push("before");
          return { token: `token:${params.id}` };
        },
        async main({ params, search, before, context }) {
          events.push("main");
          return {
            product: {
              id: params.id,
              tab: search.tab,
              token: before.token,
              tenant: (context as { tenant: string }).tenant,
            },
          };
        },
        after({ data }) {
          events.push("after");
          expect(data.product.id).toBe("product 1");
        },
      },
      component: function ProductPage() {
        return null;
      },
    });
    const pluginContext = { data: new Map<string, unknown>([["traceId", "trace-1"]]) };

    const result = await farm.route(ProductRoute, {
      params: { id: "product 1" },
      search: { tab: "reviews", locale: "am", toast: "saved" },
      pluginContext,
      middleware: { data: new Map([["feature", "catalog"]]) },
    });

    expect(result.request.url).toBe(
      "https://shop.example.com/products/product%201?tab=reviews&locale=am&toast=saved",
    );
    expect(result.props.params).toEqual({ id: "product 1" });
    expect(result.props.search).toEqual({ tab: "reviews", locale: "am", toast: "saved" });
    expect(result.props.data).toEqual({
      product: {
        id: "product 1",
        tab: "reviews",
        token: "token:product 1",
        tenant: "tenant-1",
      },
    });
    expect(result.props.context).toBe(pluginContext);
    expect(result.props.middleware?.data.get("feature")).toBe("catalog");
    expect(result.props).not.toHaveProperty("pluginContext");
    expect(result.canonicalPath).toBe("/products/product%201?tab=reviews&locale=am");
    expect(result.element.type).toBe(ProductRoute.component);
    expect(events).toEqual(["guard", "before", "main", "after"]);
    expect(contextFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { id: "product 1" },
        search: { tab: "reviews", locale: "am", toast: "saved" },
        path: "/products/product%201",
      }),
    );

    expectTypeOf(result.props.params).toEqualTypeOf<{ id: string }>();
    expectTypeOf(result.props.search.tab).toEqualTypeOf<"info" | "reviews">();
    expectTypeOf(result.props.data.product.id).toEqualTypeOf<string>();
  });

  it("lets explicit context override the harness context factory", async () => {
    const contextFactory = vi.fn(() => ({ role: "viewer" }));
    const farm = createFarmTestHarness({ context: contextFactory });
    const DashboardRoute = createRoute("/dashboard", {
      guard({ context }) {
        expect(context).toEqual({ role: "admin" });
      },
      component: function DashboardPage() {
        return null;
      },
    });

    await farm.route(DashboardRoute, { context: { role: "admin" } });

    expect(contextFactory).not.toHaveBeenCalled();
  });

  it("surfaces redirects and schema failures", async () => {
    const farm = createFarmTestHarness();
    const ProtectedRoute = createRoute("/protected/[id]", {
      params: z.object({ id: z.string().uuid() }),
      search: z.object({ access: z.enum(["allowed", "denied"]) }),
      guard({ search }) {
        if (search.access === "denied") redirect("/login");
      },
      component: function ProtectedPage() {
        return null;
      },
    });

    await expect(
      farm.route(ProtectedRoute, {
        params: { id: "550e8400-e29b-41d4-a716-446655440000" },
        search: { access: "denied" },
      }),
    ).rejects.toMatchObject({ digest: "FARM_REDIRECT;307;/login" });

    await expect(
      farm.route(ProtectedRoute, {
        params: { id: "not-a-uuid" },
        search: { access: "allowed" },
      }),
    ).rejects.toThrow('Invalid params for route "/protected/[id]"');
  });

  it("uses the real route data cache and clears it explicitly", async () => {
    const farm = createFarmTestHarness();
    const loadProduct = vi.fn(async (id: string) => ({ id }));
    const ProductRoute = createRoute("/cached/[id]", {
      params: z.object({ id: z.string() }),
      data: {
        key: ({ params }) => ["test-product", params.id],
        async main({ params }) {
          return { product: await loadProduct(params.id) };
        },
      },
      component: function CachedProductPage() {
        return null;
      },
    });

    await farm.route(ProductRoute, { params: { id: "42" } });
    await farm.route(ProductRoute, { params: { id: "42" } });
    expect(loadProduct).toHaveBeenCalledTimes(1);

    farm.clearCache();
    await farm.route(ProductRoute, { params: { id: "42" } });
    expect(loadProduct).toHaveBeenCalledTimes(2);
  });
});

describe("Farm test API harness", () => {
  it("invokes programmatic API routes with params and validation", async () => {
    const farm = createFarmTestHarness({ headers: { "x-tenant": "acme" } });
    const updateProject = createEndpoint(
      {
        method: "PATCH",
        body: z.object({ name: z.string().min(2) }),
        query: z.object({ source: z.enum(["form", "api"]) }),
        middleware: [({ headers }) => ({ tenant: headers["x-tenant"] })],
      },
      ({ body, query, params, context }) => ({
        id: params.id,
        name: body.name,
        source: query.source,
        tenant: context.tenant,
      }),
    );
    const ProjectApi = api("/api/projects/[id]", { PATCH: updateProject });

    const response = await farm.api(ProjectApi, {
      method: "PATCH",
      params: { id: "project 1" },
      query: { source: "form" },
      json: { name: "Farm" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "project 1",
      name: "Farm",
      source: "form",
      tenant: "acme",
    });

    const invalid = await farm.api(ProjectApi, {
      method: "PATCH",
      params: { id: "project-1" },
      query: { source: "api" },
      json: { name: "x" },
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: "Invalid request body" });
  });

  it("returns production-style route and handler failures", async () => {
    const farm = createFarmTestHarness();
    const ProjectsApi = api("/api/projects", {
      GET: async () => ({ projects: [] }),
    });

    const notFound = await farm.api(ProjectsApi, { path: "/api/other" });
    expect(notFound.status).toBe(404);
    await expect(notFound.json()).resolves.toEqual({ error: "Not Found" });

    const methodNotAllowed = await farm.api(ProjectsApi, { method: "DELETE" });
    expect(methodNotAllowed.status).toBe(405);
    await expect(methodNotAllowed.json()).resolves.toEqual({ error: "Method Not Allowed" });

    const BrokenApi = api("/api/broken", {
      GET: async () => {
        throw new Error("database unavailable");
      },
    });
    const failed = await farm.api(BrokenApi);
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toEqual({ error: "database unavailable" });
    await expect(farm.api(BrokenApi, { throwOnError: true })).rejects.toThrow(
      "database unavailable",
    );
  });

  it("invokes file-style endpoints directly", async () => {
    const farm = createFarmTestHarness();
    const GET = async (
      request: Request,
      { params }: { params: Promise<Record<string, string>> },
    ) => ({
      id: (await params).id,
      mode: new URL(request.url).searchParams.get("mode"),
    });

    const response = await farm.endpoint(GET, {
      path: "/api/files/guide",
      params: { id: "guide" },
      query: { mode: "raw" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "guide", mode: "raw" });
  });
});

describe("Farm test server function harness", () => {
  it("keeps schema and result inference while providing request context", async () => {
    const farm = createFarmTestHarness({
      origin: "https://actions.example.com",
      headers: { "x-tenant": "acme" },
    });
    const signup = createServerFn({
      input: z.object({ email: z.string().email() }),
      async handler({ input, request, signal }) {
        return {
          ok: true as const,
          email: input.email,
          url: request?.url,
          tenant: request?.headers.get("x-tenant"),
          signal,
        };
      },
    });

    const result = await farm.serverFn(signup, { email: "ada@example.com" });

    expect(result).toMatchObject({
      ok: true,
      email: "ada@example.com",
      url: "https://actions.example.com/__farm/test/server-fn",
      tenant: "acme",
    });
    expect(result.signal.aborted).toBe(false);
    expectTypeOf(result.ok).toEqualTypeOf<true>();
    expectTypeOf(result.email).toEqualTypeOf<string>();

    await expect(farm.serverFn(signup, { email: "invalid" })).rejects.toBeTruthy();
  });

  it("supports form input, input-less functions, exact requests, and cancellation", async () => {
    const farm = createFarmTestHarness();
    const submit = createServerFn({
      input: z.object({ title: z.string().min(1) }),
      handler: ({ input, formData, request }) => ({
        title: input.title,
        fromForm: formData instanceof FormData,
        authorization: request?.headers.get("authorization"),
      }),
    });
    const formData = new FormData();
    formData.set("title", "Test Farm");
    const request = createTestRequest("https://app.example.com/actions/submit", {
      method: "POST",
      headers: { authorization: "Bearer test" },
    });

    await expect(farm.serverFn(submit, formData, { request })).resolves.toEqual({
      title: "Test Farm",
      fromForm: true,
      authorization: "Bearer test",
    });

    const health = createServerFn({ handler: () => ({ ok: true as const }) });
    await expect(farm.serverFn(health)).resolves.toEqual({ ok: true });

    const controller = new AbortController();
    controller.abort(new Error("request cancelled"));
    await expect(
      farm.serverFn(submit, { title: "cancelled" }, { signal: controller.signal }),
    ).rejects.toThrow("request cancelled");
  });
});
