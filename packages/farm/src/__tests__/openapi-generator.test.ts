import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { OpenAPIGenerator } from "../openapi/generator";

/**
 * Schema conversion is private, and the public entry point loads route modules
 * through a bare dynamic import, which would resolve a second copy of Zod and
 * break the `instanceof` checks. Calling the method keeps the test and the
 * generator on one Zod instance.
 */
function toSchema(zodType: z.ZodType<any>): any {
  const generator = new OpenAPIGenerator(os.tmpdir(), { title: "Test API" });
  return (generator as any).processZodType(zodType);
}

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("OpenAPIGenerator", () => {
  it("represents QUERY with a request body in a valid OpenAPI 3.0 document", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = mkdtempSync(path.join(os.tmpdir(), "farm-openapi-query-"));
    tempDirs.push(root);
    const routeFile = path.join(root, "route.mjs");
    writeFileSync(routeFile, "export const QUERY = async () => Response.json({ ok: true });\n");

    const generator = new OpenAPIGenerator(root, { title: "Search API" });
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
            schema: { type: "object" },
          },
        },
      },
    });
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
});

describe("OpenAPIGenerator schema conversion", () => {
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
    expect(toSchema(z.number().optional())).toMatchObject({ type: "number", nullable: true });
    expect(toSchema(z.number().nullable())).toMatchObject({ type: "number", nullable: true });
    // The query example in docs/src/app/docs/openapi/page.md.
    expect(toSchema(z.coerce.number().int().positive().default(20))).toMatchObject({
      type: "number",
    });
  });
});
