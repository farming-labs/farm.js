import { describe, expect, it } from "vitest";
import { transformFarmServerFns } from "./server-fn-transform";

describe("Farm server function transform", () => {
  it("transforms createServerFn and createServerQuery exports", () => {
    const result = transformFarmServerFns(
      `import { createServerFn, createServerQuery } from "@farmjs/core";
export const save = createServerFn({ handler: async () => true });
export const product = createServerQuery({
  key: ({ input }) => ["product", input.id],
  handler: async ({ input }) => input,
});`,
      "/app/src/actions.ts",
    );

    expect(result?.exports).toEqual(["save", "product"]);
    expect(result?.code).toContain('"use server"');
    expect(result?.code).toContain("const $$farm_server_fn_save = createServerFn(");
    expect(result?.code).toContain("const $$farm_server_query_product = createServerQuery(");
    expect(result?.code).toContain("export async function product(input)");
  });

  it("supports aliased createServerQuery imports from the explicit entry", () => {
    const result = transformFarmServerFns(
      `import { createServerQuery as query } from "@farmjs/core/server-query";
export const product = query({ key: () => ["product"], handler: async () => true });`,
      "/app/src/product.ts",
    );

    expect(result?.exports).toEqual(["product"]);
    expect(result?.code).toContain("$$farm_server_query_product");
  });

  it("rejects query declarations in client modules", () => {
    expect(() =>
      transformFarmServerFns(
        `'use client';
import { createServerQuery } from "@farmjs/core";
export const product = createServerQuery({ key: () => ["product"], handler: async () => true });`,
        "/app/src/product.tsx",
      ),
    ).toThrow("must live in a server module");
  });
});
