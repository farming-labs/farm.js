import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";
import * as z3 from "zod/v3";
import { createEndpoint } from "../api/endpoint";
import { APIRouteManager } from "../api/route-manager";
import { OpenAPIGenerator } from "../openapi/generator";
import { OpenAPIManager } from "../openapi/manager";
import { definePlugin } from "../plugin";

function toSchema(schema: unknown): any {
  const generator = new OpenAPIGenerator(os.tmpdir(), { title: "Test API" });
  return (generator as any).processZodType(schema);
}

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("OpenAPIGenerator", () => {
  it("uses local and same-origin API servers for development and production", async () => {
    const development = new OpenAPIGenerator(
      os.tmpdir(),
      { title: "Development API" },
      {
        mode: "development",
        apiBaseURL: "/api",
      },
    );
    const production = new OpenAPIGenerator(
      os.tmpdir(),
      { title: "Production API" },
      {
        mode: "production",
        apiBaseURL: "/api",
      },
    );

    await expect(development.generateSpec([])).resolves.toMatchObject({
      servers: [{ url: "http://localhost:3000/api", description: "Development server" }],
    });
    await expect(production.generateSpec([])).resolves.toMatchObject({
      servers: [{ url: "/api", description: "Same-origin API server" }],
    });
  });

  it("resolves explicit, Farm, and request-derived server URLs in order", async () => {
    const explicit = new OpenAPIGenerator(
      os.tmpdir(),
      { title: "Explicit API", servers: [{ url: "https://docs.example/v2" }] },
      { mode: "production", apiBaseURL: "https://farm.example/api" },
    );
    const farm = new OpenAPIGenerator(
      os.tmpdir(),
      { title: "Farm API" },
      {
        mode: "production",
        apiBaseURL: "https://farm.example/api",
      },
    );
    const request = new OpenAPIGenerator(
      os.tmpdir(),
      { title: "Request API" },
      {
        mode: "development",
        apiBaseURL: "/internal-api",
      },
    );

    expect((await explicit.generateSpec([], "https://request.example")).servers).toEqual([
      { url: "https://docs.example/v2" },
    ]);
    expect((await farm.generateSpec([], "https://request.example")).servers).toEqual([
      { url: "https://farm.example/api", description: "Farm API server" },
    ]);
    expect((await request.generateSpec([], "http://127.0.0.1:4173")).servers).toEqual([
      {
        url: "http://127.0.0.1:4173/internal-api",
        description: "Current development server",
      },
    ]);
  });

  it("represents QUERY with a request body in a valid OpenAPI 3.0 document", async () => {
    const routeFile = realpathSync(
      path.resolve("src/__tests__/fixtures/openapi-request-bodies-route.mjs"),
    );

    const generator = new OpenAPIGenerator(path.dirname(routeFile), { title: "Search API" });
    const spec = await generator.generateSpec([
      {
        path: "/api/search",
        methods: ["QUERY"],
        filePath: realpathSync(routeFile),
        relativePath: "api/search/route.ts",
      },
    ]);

    expect(spec.openapi).toBe("3.0.3");
    expect(spec.paths["/search"].query).toBeUndefined();
    expect(spec.paths["/search"]["x-oai-additionalOperations"].QUERY).toMatchObject({
      operationId: "query_search",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { term: { type: "string" } },
              required: ["term"],
            },
          },
        },
      },
    });
  });

  it("only requires request bodies declared by endpoint schemas", async () => {
    const routeFile = realpathSync(
      path.resolve("src/__tests__/fixtures/openapi-request-bodies-route.mjs"),
    );
    const generator = new OpenAPIGenerator(path.dirname(routeFile), { title: "Bodies API" });
    const spec = await generator.generateSpec([
      {
        path: "/api/resources",
        methods: ["POST", "PUT", "PATCH", "DELETE"],
        filePath: routeFile,
        relativePath: "api/resources/route.ts",
      },
    ]);

    expect(spec.paths["/resources"].post).not.toHaveProperty("requestBody");
    expect(spec.paths["/resources"].put).not.toHaveProperty("requestBody");
    expect(spec.paths["/resources"].patch.requestBody).toMatchObject({
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
      },
    });
    expect(spec.paths["/resources"].delete.requestBody).toMatchObject({
      required: false,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { force: { type: "boolean" } },
            required: ["force"],
          },
        },
      },
    });
  });

  it("keeps request bodies optional when route metadata cannot be loaded", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const missingRoute = path.resolve("src/__tests__/fixtures/missing-openapi-route.mjs");
    const generator = new OpenAPIGenerator(path.dirname(missingRoute), {
      title: "Fallback API",
    });
    const spec = await generator.generateSpec([
      {
        path: "/api/unavailable",
        methods: ["POST"],
        filePath: missingRoute,
        relativePath: "api/unavailable/route.ts",
      },
    ]);

    expect(spec.paths["/unavailable"].post.requestBody).toMatchObject({
      required: false,
      content: {
        "application/json": {
          schema: { type: "object", description: "Request body" },
        },
      },
    });
  });

  it("applies configurable security per endpoint", async () => {
    const routeFile = realpathSync(
      path.resolve("src/__tests__/fixtures/openapi-security-route.mjs"),
    );

    const generator = new OpenAPIGenerator(path.dirname(routeFile), {
      title: "Security API",
      security: "cookie",
    });
    const spec = await generator.generateSpec([
      {
        path: "/api/account",
        methods: ["GET", "POST", "PUT"],
        filePath: realpathSync(routeFile),
        relativePath: "api/account/route.ts",
      },
    ]);

    expect(spec.paths["/account"].get).not.toHaveProperty("security");
    expect(spec.paths["/account"].post.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.paths["/account"].put.security).toEqual([{ apiKeyCookie: [] }]);
    expect(spec.components?.securitySchemes).toMatchObject({
      bearerAuth: expect.any(Object),
      apiKeyCookie: expect.any(Object),
    });
  });

  it("uses explicit endpoint response metadata without inventing responses", async () => {
    const routeFile = realpathSync(
      path.resolve("src/__tests__/fixtures/openapi-responses-route.mjs"),
    );
    const generator = new OpenAPIGenerator(path.dirname(routeFile), { title: "Responses API" });
    const spec = await generator.generateSpec([
      {
        path: "/api/account",
        methods: ["GET", "POST", "PUT", "PATCH"],
        filePath: routeFile,
        relativePath: "api/account/route.ts",
      },
    ]);

    expect(spec.paths["/account"].get.responses).toEqual({
      200: {
        description: "Current account",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { id: { type: "string" } },
              required: ["id"],
            },
          },
        },
      },
    });
    expect(spec.paths["/account"].post.responses).toEqual({
      204: { description: "Account removed" },
    });
    expect(spec.paths["/account"].put.responses).toEqual({
      200: {
        description: "Streaming response",
        content: { "application/x-ndjson": {} },
      },
    });
    expect(spec.paths["/account"].patch.responses).toEqual({
      206: {
        description: "Binary response",
        content: {
          "application/pdf": { schema: { type: "string", format: "binary" } },
        },
      },
    });
  });

  it("uses a conservative response fallback when metadata is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = mkdtempSync(path.join(os.tmpdir(), "farm-openapi-response-fallback-"));
    tempDirs.push(root);
    const routeFile = path.join(root, "route.mjs");
    writeFileSync(routeFile, "export const GET = async () => new Response();\n");
    const generator = new OpenAPIGenerator(root, { title: "Fallback API" });
    const spec = await generator.generateSpec([
      {
        path: "/api/unknown",
        methods: ["GET"],
        filePath: realpathSync(routeFile),
        relativePath: "api/unknown/route.ts",
      },
    ]);

    expect(spec.paths["/unknown"].get.responses).toEqual({
      default: { description: "Response metadata is unavailable." },
    });
  });
});

describe("OpenAPI route visibility", () => {
  it("leaves hidden operations out without leaving an empty path", async () => {
    const generator = new OpenAPIGenerator(os.tmpdir(), { title: "Visibility API" });
    const spec = await generator.generateSpec([
      {
        path: "/api/projects",
        methods: ["GET", "POST"],
        endpoints: {
          GET: createEndpoint({ method: "GET" }, async () => ({ projects: [] })),
          POST: createEndpoint({ method: "POST", openapi: { hidden: true } }, async () => ({})),
        },
      },
      {
        path: "/api/admin/session",
        methods: ["POST"],
        endpoints: { POST: async () => new Response(null, { status: 303 }) },
        openapi: { POST: { hidden: true } },
      },
    ]);

    expect(Object.keys(spec.paths)).toEqual(["/projects"]);
    expect(Object.keys(spec.paths["/projects"])).toEqual(["get"]);
  });

  it("leaves out routes that are not served beneath the API server", async () => {
    const generator = new OpenAPIGenerator(os.tmpdir(), { title: "Programmatic API" });
    const spec = await generator.generateSpec([
      { path: "/api", methods: ["GET"], endpoints: { GET: async () => new Response() } },
      {
        path: "/sitemap-site.xml",
        methods: ["GET"],
        endpoints: { GET: async () => new Response() },
      },
    ]);

    expect(Object.keys(spec.paths)).toEqual(["/"]);
  });

  it("documents the mounted route table, plugin routes included", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "farm-openapi-mounted-"));
    tempDirs.push(root);
    const modules: Record<string, Record<string, unknown>> = {
      "items/route.ts": {
        POST: createEndpoint(
          { method: "POST", body: z.object({ name: z.string() }) },
          async () => ({ ok: true }),
        ),
      },
      "admin/session/route.ts": {
        POST: async () => new Response(null, { status: 303 }),
        openapi: { hidden: true },
      },
    };
    for (const file of Object.keys(modules)) {
      const filePath = path.join(root, "api", file);
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, "export {};\n");
    }
    const projectRoutes = definePlugin({
      name: "test:project-routes",
      routes: ({ route }) => [
        route.get("/api/projects/[projectId]", {
          input: { query: z.object({ view: z.enum(["summary", "full"]) }) },
          handler: () => ({ ok: true }),
        }),
        route.post("/api/projects/internal", {
          openapi: { hidden: true },
          handler: () => ({ ok: true }),
        }),
      ],
    });
    const routeManager = new APIRouteManager(
      root,
      {
        environments: {
          ssr: {
            runner: {
              import: async (filePath: string) =>
                modules[path.relative(path.join(root, "api"), filePath).replace(/\\/g, "/")],
            },
          },
        },
      } as any,
      { plugins: [projectRoutes] },
    );
    await routeManager.discoverRoutes();

    const manager = new OpenAPIManager(
      root,
      { title: "Mounted API" },
      { routes: () => routeManager.getRoutes().values() },
    );
    const spec = await manager.generateSpec();

    expect(Object.keys(spec.paths).sort()).toEqual(["/items", "/projects/{projectId}"]);
    expect(spec.paths["/items"].post.requestBody).toMatchObject({
      required: true,
      content: {
        "application/json": {
          schema: { type: "object", properties: { name: { type: "string" } } },
        },
      },
    });
    expect(spec.paths["/projects/{projectId}"].get.parameters).toEqual([
      { name: "projectId", in: "path", required: true, schema: { type: "string" } },
      expect.objectContaining({ name: "view", in: "query", required: true }),
    ]);
  });

  it("reads the openapi export of a scanned route file", async () => {
    const fixture = (name: string) => realpathSync(path.resolve(`src/__tests__/fixtures/${name}`));
    const generator = new OpenAPIGenerator(path.resolve("src/__tests__/fixtures"), {
      title: "Scanned API",
    });

    const spec = await generator.generateSpec([
      { path: "/api/hidden", methods: ["GET"], filePath: fixture("openapi-hidden-route.mjs") },
    ]);
    expect(spec.paths).toEqual({});
    await expect(
      generator.generateSpec([
        {
          path: "/api/misspelled",
          methods: ["GET"],
          filePath: fixture("openapi-misspelled-route.mjs"),
        },
      ]),
    ).rejects.toThrow(
      'API route "/api/misspelled" exports "openapi" with an unknown option "hide"',
    );
  });

  it("adds configured paths for routes served without a route file", async () => {
    const docsSearch = {
      summary: "Search the docs",
      parameters: [{ name: "query", in: "query", schema: { type: "string" } }],
      responses: { 200: { description: "Matching sections" } },
    };
    const generator = new OpenAPIGenerator(os.tmpdir(), {
      title: "Configured API",
      paths: { "/docs": { get: docsSearch } },
    });
    const routes = [
      {
        path: "/api/docs",
        methods: ["POST"],
        endpoints: { POST: createEndpoint({ method: "POST" }, async () => ({})) },
      },
    ];

    const spec = await generator.generateSpec(routes);
    expect(spec.paths["/docs"].get).toEqual(docsSearch);
    expect(spec.paths["/docs"].post.operationId).toBe("post_docs");

    const conflicting = new OpenAPIGenerator(os.tmpdir(), {
      title: "Conflicting API",
      paths: { "/docs": { post: docsSearch } },
    });
    await expect(conflicting.generateSpec(routes)).rejects.toThrow(
      'openapi.paths["/docs"].post describes an operation Farm already generates',
    );
  });
});

describe("OpenAPIGenerator dynamic paths", () => {
  it("templates dynamic segments and emits path parameters", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = mkdtempSync(path.join(os.tmpdir(), "farm-openapi-path-"));
    tempDirs.push(root);
    const routeFile = path.join(root, "route.mjs");
    writeFileSync(routeFile, "export const GET = async () => Response.json({ ok: true });\n");

    const generator = new OpenAPIGenerator(root, { title: "Users API" });
    const spec = await generator.generateSpec([
      {
        path: "/api/users/[id]",
        methods: ["GET"],
        filePath: realpathSync(routeFile),
        relativePath: "api/users/[id]/route.ts",
      },
    ]);

    // OpenAPI templating, not the raw bracket form.
    expect(spec.paths["/users/{id}"]).toBeDefined();
    expect(spec.paths["/users/[id]"]).toBeUndefined();
    expect(spec.paths["/users/{id}"].get.parameters).toContainEqual({
      name: "id",
      in: "path",
      required: true,
      schema: { type: "string" },
    });
  });

  it("templates catch-all and optional catch-all segments", () => {
    const generator = new OpenAPIGenerator(os.tmpdir(), { title: "T" });
    const convert = (p: string) => (generator as any).convertToOpenAPIPath(p);
    expect(convert("/api/files/[...slug]")).toBe("/files/{slug}");
    expect(convert("/api/files/[[...slug]]")).toBe("/files/{slug}");
    expect(convert("/api/a/[x]/b/[y]")).toBe("/a/{x}/b/{y}");
  });

  it("expands optional catch-all routes without making a path parameter optional", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = mkdtempSync(path.join(os.tmpdir(), "farm-openapi-catch-all-"));
    tempDirs.push(root);
    const routeFile = path.join(root, "route.mjs");
    writeFileSync(routeFile, "export const GET = async () => new Response();\n");

    const generator = new OpenAPIGenerator(root, { title: "Files API" });
    const spec = await generator.generateSpec([
      {
        path: "/api/files/[[...slug]]",
        methods: ["GET"],
        filePath: realpathSync(routeFile),
        relativePath: "api/files/[[...slug]]/route.ts",
      },
      {
        path: "/api/archive/[...slug]",
        methods: ["GET"],
        filePath: realpathSync(routeFile),
        relativePath: "api/archive/[...slug]/route.ts",
      },
    ]);

    expect(spec.paths["/files"].get).not.toHaveProperty("parameters");
    expect(spec.paths["/files"].get.operationId).toBe("get_files_[[...slug]]_base");
    expect(spec.paths["/files/{slug}"].get).toMatchObject({
      operationId: "get_files_[[...slug]]",
      parameters: [
        {
          name: "slug",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
    });
    expect(spec.paths["/archive"]).toBeUndefined();
    expect(spec.paths["/archive/{slug}"].get.parameters[0]).toMatchObject({
      name: "slug",
      required: true,
    });
  });

  it("preserves explicit operations beside optional catch-all fallbacks", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = mkdtempSync(path.join(os.tmpdir(), "farm-openapi-catch-all-precedence-"));
    tempDirs.push(root);
    const routeFile = path.join(root, "route.mjs");
    writeFileSync(
      routeFile,
      [
        "export const GET = async () => new Response();",
        "export const QUERY = async () => new Response();",
        "",
      ].join("\n"),
    );

    const optionalCatchAll = {
      path: "/api/files/[[...slug]]",
      methods: ["GET", "QUERY"],
      filePath: realpathSync(routeFile),
      relativePath: "api/files/[[...slug]]/route.ts",
    };
    const explicit = {
      path: "/api/files",
      methods: ["GET", "QUERY"],
      filePath: realpathSync(routeFile),
      relativePath: "api/files/route.ts",
    };

    for (const routes of [
      [optionalCatchAll, explicit],
      [explicit, optionalCatchAll],
    ]) {
      const generator = new OpenAPIGenerator(root, { title: "Files API" });
      const spec = await generator.generateSpec(routes);

      expect(spec.paths["/files"].get.operationId).toBe("get_files");
      expect(spec.paths["/files"]["x-oai-additionalOperations"].QUERY.operationId).toBe(
        "query_files",
      );
      expect(spec.paths["/files/{slug}"].get.operationId).toBe("get_files_[[...slug]]");
      expect(spec.paths["/files/{slug}"]["x-oai-additionalOperations"].QUERY.operationId).toBe(
        "query_files_[[...slug]]",
      );
    }
  });
});

describe("OpenAPIGenerator schema conversion", () => {
  it("reads schemas from a separate Zod constructor family", () => {
    const schema = toSchema(
      z3.object({
        name: z3.string().min(2),
        page: z3.number().min(1).optional(),
      }),
    );
    expect(schema).toMatchObject({
      type: "object",
      properties: {
        name: { type: "string", minLength: 2 },
        page: { type: "number", minimum: 1 },
      },
      required: ["name"],
    });
    expect(schema.properties.page).not.toHaveProperty("nullable");
  });

  it("uses an explicit metadata-unavailable fallback for Standard Schema validators", () => {
    const validator = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value: unknown) => ({ value }),
      },
    };

    expect(toSchema(validator)).toEqual({
      description: "Schema metadata is unavailable for this Standard Schema validator.",
    });
  });

  it("does not mark a defaulted field as required", () => {
    const schema = toSchema(
      z.object({
        name: z.string(),
        role: z.string().default("user"),
        nickname: z.string().optional(),
      }),
    );
    expect(schema.required).toEqual(["name"]);
  });

  it("documents a literal as an enum with its value", () => {
    expect(toSchema(z.literal("admin"))).toMatchObject({ type: "string", enum: ["admin"] });
    expect(toSchema(z.literal(42))).toMatchObject({ type: "number", enum: [42] });
  });

  it("documents a union as oneOf over its members", () => {
    expect(toSchema(z.union([z.string(), z.number()]))).toMatchObject({
      oneOf: [{ type: "string" }, { type: "number" }],
    });
  });

  it("documents a record as an object with additionalProperties", () => {
    expect(toSchema(z.record(z.string(), z.number()))).toMatchObject({
      type: "object",
      additionalProperties: { type: "number" },
    });
  });

  it("documents a tuple as a length-pinned array", () => {
    expect(toSchema(z.tuple([z.string(), z.number()]))).toMatchObject({
      type: "array",
      items: { oneOf: [{ type: "string" }, { type: "number" }] },
      minItems: 2,
      maxItems: 2,
    });
  });

  it("includes variadic tuple rest schemas in the item union", () => {
    expect(toSchema(z.tuple([z.string()]).rest(z.number()))).toMatchObject({
      type: "array",
      items: { oneOf: [{ type: "string" }, { type: "number" }] },
    });
    expect(toSchema(z.tuple([z.string(), z.number()]).rest(z.boolean()))).toMatchObject({
      type: "array",
      items: {
        oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
      },
    });
    expect(toSchema(z.tuple([]).rest(z.boolean()))).toMatchObject({
      type: "array",
      items: { type: "boolean" },
    });
    expect(toSchema(z3.tuple([z3.string()]).rest(z3.number()))).toMatchObject({
      type: "array",
      items: { oneOf: [{ type: "string" }, { type: "number" }] },
    });
  });

  it("keeps the declared type for primitives", () => {
    expect(toSchema(z.string())).toMatchObject({ type: "string" });
    expect(toSchema(z.number())).toMatchObject({ type: "number" });
    expect(toSchema(z.boolean())).toMatchObject({ type: "boolean" });
  });

  it("documents an array with its element schema", () => {
    expect(toSchema(z.array(z.string()))).toMatchObject({
      type: "array",
      items: { type: "string" },
    });
    expect(toSchema(z.array(z.number()))).toMatchObject({
      type: "array",
      items: { type: "number" },
    });
  });

  it("documents an object that contains an array field", () => {
    expect(toSchema(z.object({ name: z.string(), tags: z.array(z.string()) }))).toMatchObject({
      type: "object",
      properties: {
        name: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["name", "tags"],
    });
  });

  it("lists the allowed values of an enum", () => {
    expect(toSchema(z.enum(["asc", "desc"]))).toMatchObject({
      type: "string",
      enum: ["asc", "desc"],
    });
  });

  it("carries string and numeric constraints into the schema", () => {
    expect(toSchema(z.string().min(2).max(5))).toMatchObject({
      type: "string",
      minLength: 2,
      maxLength: 5,
    });
    expect(toSchema(z.number().min(1).max(9))).toMatchObject({
      type: "number",
      minimum: 1,
      maximum: 9,
    });
  });

  it("does not emit Zod 4's implicit safe-integer bounds for int()", () => {
    // .int() implies +/-Number.MAX_SAFE_INTEGER; only author-declared bounds
    // belong in the document.
    expect(toSchema(z.number().int())).not.toHaveProperty("maximum");
    expect(toSchema(z.number().int())).not.toHaveProperty("minimum");
    expect(toSchema(z.number().int().min(1))).toMatchObject({ type: "number", minimum: 1 });
    expect(toSchema(z.number().int().min(1))).not.toHaveProperty("maximum");
  });

  it("keeps a zero bound and omits an absent one", () => {
    expect(toSchema(z.number().min(0))).toMatchObject({ type: "number", minimum: 0 });
    expect(toSchema(z.number())).not.toHaveProperty("minimum");
    expect(toSchema(z.number())).not.toHaveProperty("maximum");
  });

  it("survives JSON serialization with its constraints", () => {
    // A constraint read from a Zod method rather than a value would be a function,
    // which JSON.stringify drops without reporting anything.
    const serialized = JSON.parse(JSON.stringify(toSchema(z.number().min(1).max(9))));
    expect(serialized).toEqual({ type: "number", minimum: 1, maximum: 9 });
  });

  it("unwraps optional, nullable, and defaulted schemas", () => {
    const optional = toSchema(z.number().optional());
    expect(optional).toMatchObject({ type: "number" });
    expect(optional).not.toHaveProperty("nullable");
    expect(toSchema(z.number().nullable())).toMatchObject({ type: "number", nullable: true });
    // The query example in docs/src/app/docs/openapi/page.md.
    expect(toSchema(z.coerce.number().int().positive().default(20))).toMatchObject({
      type: "number",
    });
  });

  it("keeps optional object properties non-nullable", () => {
    const schema = toSchema(
      z.object({
        optionalValue: z.string().optional(),
        nullableValue: z.string().nullable(),
      }),
    );

    expect(schema.properties.optionalValue).not.toHaveProperty("nullable");
    expect(schema.properties.nullableValue).toMatchObject({ type: "string", nullable: true });
    expect(schema.required).toEqual(["nullableValue"]);
  });
});
