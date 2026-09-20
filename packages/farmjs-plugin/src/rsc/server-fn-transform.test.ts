import { describe, expect, it } from "vitest";
import { transformFarmServerFns } from "./server-fn-transform";

describe("Farm server function transform", () => {
  it("transforms createServerFn and createServerQuery exports", () => {
    const result = transformFarmServerFns(
      `import { createServerFn, createServerQuery } from "@farm.js/core";
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
      `import { createServerQuery as query } from "@farm.js/core/server-query";
export const product = query({ key: () => ["product"], handler: async () => true });`,
      "/app/src/product.ts",
    );

    expect(result?.exports).toEqual(["product"]);
    expect(result?.code).toContain("$$farm_server_query_product");
  });

  it("transforms exports that pass explicit type arguments to the factory", () => {
    const result = transformFarmServerFns(
      `import { createServerFn, createServerQuery } from "@farm.js/core";
export const save = createServerFn<{ name: string }>({ handler: async () => true });
export const product = createServerQuery<Params<Id>>({ key: () => ["product"], handler: async () => true });`,
      "/app/src/actions.ts",
    );

    expect(result?.exports).toEqual(["save", "product"]);
    expect(result?.code).toContain('"use server"');
    expect(result?.code).toContain(
      "const $$farm_server_fn_save = createServerFn<{ name: string }>(",
    );
    expect(result?.code).toContain(
      "const $$farm_server_query_product = createServerQuery<Params<Id>>(",
    );
    expect(result?.code).toContain("export async function save(input)");
  });

  it("does not let adjacent core imports consume server function imports", () => {
    const result = transformFarmServerFns(
      `import { invalidate } from "@farm.js/core/cache";
import { createServerFn } from "@farm.js/core/server-fn";
import { createServerQuery } from "@farm.js/core/server-query";
export const product = createServerQuery({ key: () => ["product"], handler: async () => true });
export const update = createServerFn({ handler: async () => { invalidate(["product"]); } });`,
      "/app/src/product.ts",
    );

    expect(result?.exports).toEqual(["product", "update"]);
    expect(result?.code).toContain("export async function update(input)");
  });

  it("transforms a default-exported server function so it gets a server boundary", () => {
    // Without this the module gets no "use server" directive and the handler
    // (and its server-only imports) ships to the client.
    const result = transformFarmServerFns(
      `import { createServerFn } from "@farm.js/core";
export default createServerFn({ handler: async () => true });`,
      "/app/src/actions.ts",
    );

    expect(result).not.toBeNull();
    expect(result?.exports).toEqual(["default"]);
    expect(result?.code).toContain('"use server"');
    expect(result?.code).toContain("const $$farm_server_fn_default = createServerFn(");
    expect(result?.code).toContain("export default async function (input)");
    // The raw factory call must no longer be the default export.
    expect(result?.code).not.toContain("export default createServerFn(");
  });

  it("rejects query declarations in client modules", () => {
    expect(() =>
      transformFarmServerFns(
        `'use client';
import { createServerQuery } from "@farm.js/core";
export const product = createServerQuery({ key: () => ["product"], handler: async () => true });`,
        "/app/src/product.tsx",
      ),
    ).toThrow("must live in a server module");
  });
});
