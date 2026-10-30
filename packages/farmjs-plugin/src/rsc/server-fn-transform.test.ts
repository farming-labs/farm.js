import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { _describeServerFunction } from "@farm.js/core/server-fn";
import { transformServerActionServer } from "@vitejs/plugin-rsc/transforms";
import { parseAstAsync } from "vite";
import { createFarmServerFnBoundaryModule, transformFarmServerFns } from "./server-fn-transform";

/** The names @vitejs/plugin-rsc registers as callable server actions for a module. */
async function registeredActionNames(code: string) {
  const result = transformServerActionServer(code, await parseAstAsync(code), {
    runtime: (value: string, name: string) => `register(${value}, ${JSON.stringify(name)})`,
    rejectNonAsyncFunction: true,
  });
  return result.output.hasChanged() ? result.referenceNames : [];
}

const SIBLING_EXPORT_MODULE = `import { createServerFn, createServerMiddleware } from "@farm.js/core/server-fn";
const requireSession = createServerMiddleware({ handler: async ({ next }) => next() });
export async function loadAccount(userId) {
  return { userId };
}
export const getProfile = createServerFn({
  middleware: [requireSession],
  handler: async () => loadAccount("me"),
});`;

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
    expect(result?.code).not.toContain('"use server"');
    expect(result?.code).toContain("const $$farm_server_fn_save = createServerFn(");
    expect(result?.code).toContain("const $$farm_server_query_product = createServerQuery(");
    expect(result?.code).toContain(
      'import { save, product } from "/app/src/actions.ts?farm-server-fns";',
    );
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
    expect(result?.code).toContain(
      "const $$farm_server_fn_save = createServerFn<{ name: string }>(",
    );
    expect(result?.code).toContain(
      "const $$farm_server_query_product = createServerQuery<Params<Id>>(",
    );
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
    expect(result?.code).toContain("const $$farm_server_fn_update = createServerFn(");
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
    expect(result?.code).toContain("const $$farm_server_fn_default = createServerFn(");
    expect(result?.code).toContain("$$farm_server_fn_boundary_default as default");
    expect(
      createFarmServerFnBoundaryModule(
        `import { createServerFn } from "@farm.js/core";
export default createServerFn({ handler: async () => true });`,
        "/app/src/actions.ts",
      ),
    ).toContain("export default async function $$farm_server_fn_default_export(input)");
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

  it("fails closed for server functions re-exported through an export clause", () => {
    expect(() =>
      transformFarmServerFns(
        `import { createServerFn } from "@farm.js/core";
const save = createServerFn({ handler: async () => true });
export { save as persist };`,
        "/app/src/actions.ts",
      ),
    ).toThrow(
      'Server function "save" cannot be re-exported with an export clause. Export it inline instead',
    );
  });

  it("does not treat re-exports from another module as local server functions", () => {
    const result = transformFarmServerFns(
      `import { save } from "./save";
export { save } from "./save";`,
      "/app/src/actions.ts",
    );

    expect(result).toBeNull();
  });

  it("names the query factory in the fail-closed message", () => {
    expect(() =>
      transformFarmServerFns(
        `import { createServerQuery } from "@farm.js/core";
const product = createServerQuery({ key: () => ["product"], handler: async () => true });
export { product };`,
        "/app/src/queries.ts",
      ),
    ).toThrow("createServerQuery(...)");
  });

  it("fails closed for a server function re-exported as the default export", () => {
    expect(() =>
      transformFarmServerFns(
        `import { createServerFn } from "@farm.js/core";
const save = createServerFn({ handler: async () => true });
export default save;`,
        "/app/src/actions.ts",
      ),
    ).toThrow(
      'Server function "save" cannot be re-exported as the default export. Export it inline instead: export default createServerFn(...)',
    );
  });

  it("fails closed for a server function re-exported through a renamed binding", () => {
    expect(() =>
      transformFarmServerFns(
        `import { createServerFn } from "@farm.js/core";
const save = createServerFn({ handler: async () => true });
export const persist = save;`,
        "/app/src/actions.ts",
      ),
    ).toThrow(
      'Server function "save" cannot be re-exported through another exported binding. Export it inline instead: export const persist = createServerFn(...)',
    );
  });

  it("fails closed when a comment hides the specifier inside an export clause", () => {
    expect(() =>
      transformFarmServerFns(
        `import { createServerFn } from "@farm.js/core";
const save = createServerFn({ handler: async () => true });
export { /* re-export */ save };`,
        "/app/src/actions.ts",
      ),
    ).toThrow('Server function "save" cannot be re-exported with an export clause.');
  });

  it("fails closed when the server function is assigned after its declaration", () => {
    expect(() =>
      transformFarmServerFns(
        `import { createServerFn } from "@farm.js/core";
let save;
save = createServerFn({ handler: async () => true });
export { save };`,
        "/app/src/actions.ts",
      ),
    ).toThrow('Server function "save" cannot be re-exported with an export clause.');
  });

  it("ignores export-shaped text inside strings and comments", () => {
    const result = transformFarmServerFns(
      `import { createServerFn } from "@farm.js/core";
// export { save };
const note = "export default save;";
export const save = createServerFn({ handler: async () => note });`,
      "/app/src/actions.ts",
    );

    expect(result?.exports).toEqual(["save"]);
    expect(result?.code).toContain("const $$farm_server_fn_save = createServerFn(");
  });

  it("registers only the server functions when the module has no directive", async () => {
    const id = "/app/src/actions/account.ts";
    const server = transformFarmServerFns(SIBLING_EXPORT_MODULE, id, { environment: "rsc" });
    const boundary = createFarmServerFnBoundaryModule(SIBLING_EXPORT_MODULE, id);

    // The source module keeps the helper as a plain export and is no reference.
    expect(server?.code).not.toContain('"use server"');
    expect(server?.code).toContain("export async function loadAccount(userId)");
    expect(await registeredActionNames(server!.code)).toEqual([]);
    // The boundary is the only reference module, and it names just getProfile.
    expect(boundary).toContain(`from "${id}"`);
    expect(boundary).not.toContain("loadAccount");
    expect(await registeredActionNames(boundary!)).toEqual(["getProfile"]);
    // Before the boundary, the implicit directive registered the helper too.
    expect(await registeredActionNames(`"use server";\n${SIBLING_EXPORT_MODULE}`)).toEqual([
      "loadAccount",
      "getProfile",
    ]);
  });

  it("gives client and SSR builds only the server function references", () => {
    const result = transformFarmServerFns(SIBLING_EXPORT_MODULE, "/app/src/actions/account.ts", {
      environment: "client",
    });

    expect(result?.code).toBe(
      'export { getProfile } from "/app/src/actions/account.ts?farm-server-fns";\n',
    );
  });

  it("keeps every export an action when the module declares use server", async () => {
    const code = `"use server";\n${SIBLING_EXPORT_MODULE}`;
    const result = transformFarmServerFns(code, "/app/src/actions/account.ts", {
      environment: "client",
    });

    expect(result?.code.startsWith('"use server";')).toBe(true);
    expect(result?.code).toContain("export async function getProfile(input)");
    expect(createFarmServerFnBoundaryModule(code, "/app/src/actions/account.ts")).toBeNull();
    expect(await registeredActionNames(result!.code)).toEqual(["loadAccount", "getProfile"]);
  });

  it("keeps the descriptor MCP reads on the exported wrappers", async () => {
    const source = `import { createServerFn } from "@farm.js/core/server-fn";
export const save = createServerFn({ mcp: { name: "save" }, handler: async () => "saved" });
export default createServerFn({ mcp: { name: "fallback" }, handler: async () => "default" });`;
    const coreEntry = createRequire(import.meta.url).resolve("@farm.js/core/server-fn");
    const coreUrl = JSON.stringify(pathToFileURL(coreEntry).href);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "farm-server-fn-transform-"));
    try {
      const sourceFile = path.join(dir, "actions.mjs").replace(/\\/g, "/");
      const boundaryFile = path.join(dir, "boundary.mjs");
      const boundaryUrl = JSON.stringify(pathToFileURL(boundaryFile).href);
      const server = transformFarmServerFns(source, sourceFile, { environment: "rsc" })!;
      await fs.writeFile(
        sourceFile,
        server.code
          .replace('"@farm.js/core/server-fn"', coreUrl)
          .replace(JSON.stringify(`${sourceFile}?farm-server-fns`), boundaryUrl),
      );
      await fs.writeFile(
        boundaryFile,
        createFarmServerFnBoundaryModule(source, sourceFile)!.replace(
          JSON.stringify(sourceFile),
          JSON.stringify(pathToFileURL(sourceFile).href),
        ),
      );
      const explicitFile = path.join(dir, "explicit.mjs");
      await fs.writeFile(
        explicitFile,
        transformFarmServerFns(`"use server";\n${source}`, explicitFile)!.code.replace(
          '"@farm.js/core/server-fn"',
          coreUrl,
        ),
      );

      // Load the boundary first, as the action manifest does, then the source.
      const boundary = await import(/* @vite-ignore */ pathToFileURL(boundaryFile).href);
      const module = await import(/* @vite-ignore */ pathToFileURL(sourceFile).href);
      const explicit = await import(/* @vite-ignore */ pathToFileURL(explicitFile).href);

      for (const target of [module, explicit]) {
        expect(_describeServerFunction(target.save)?.mcp).toEqual({ name: "save" });
        expect(_describeServerFunction(target.default)?.mcp).toEqual({ name: "fallback" });
        await expect(target.save()).resolves.toBe("saved");
      }
      // Server code that imports the source module gets the boundary's references.
      expect(module.save).toBe(boundary.save);
      expect(module.default).toBe(boundary.default);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
