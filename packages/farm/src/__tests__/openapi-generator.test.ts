import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenAPIGenerator } from "../openapi/generator";

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

describe("OpenAPIGenerator zod schema conversion", () => {
  function processed(schema: z.ZodType<any>): any {
    const generator = new OpenAPIGenerator("/tmp", { title: "t" });
    const result = (generator as any).processZodType(schema);
    return JSON.parse(JSON.stringify(result));
  }

  it("converts primitive types", () => {
    expect(processed(z.string())).toEqual({ type: "string" });
    expect(processed(z.number())).toEqual({ type: "number" });
    expect(processed(z.boolean())).toEqual({ type: "boolean" });
  });

  it("converts enums with their values", () => {
    expect(processed(z.enum(["asc", "desc"]))).toEqual({
      type: "string",
      enum: ["asc", "desc"],
    });
  });

  it("converts string length constraints", () => {
    expect(processed(z.string().min(2).max(5))).toEqual({
      type: "string",
      minLength: 2,
      maxLength: 5,
    });
  });

  it("converts numeric range constraints", () => {
    expect(processed(z.number().min(1).max(9))).toEqual({
      type: "number",
      minimum: 1,
      maximum: 9,
    });
  });

  it("converts the coerced number with a default from the docs example", () => {
    const schema = processed(z.coerce.number().int().positive().default(20));
    expect(schema).toMatchObject({ type: "number", default: 20 });
  });

  it("converts arrays without throwing", () => {
    expect(processed(z.array(z.string()))).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });

  it("converts objects containing arrays", () => {
    expect(processed(z.object({ name: z.string(), tags: z.array(z.string()) }))).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["name", "tags"],
    });
  });

  it("marks optional types as nullable", () => {
    expect(processed(z.number().optional())).toEqual({
      type: "number",
      nullable: true,
    });
  });

  it("keeps descriptions", () => {
    expect(processed(z.number().describe("a count"))).toEqual({
      type: "number",
      description: "a count",
    });
  });
});
