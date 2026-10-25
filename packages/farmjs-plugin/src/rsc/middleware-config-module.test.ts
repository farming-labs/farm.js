import { parseAst } from "vite";
import { describe, expect, it } from "vitest";
import {
  extractRscConfigPropertyModule,
  extractRscMiddlewareConfigModule,
} from "./middleware-config-module.js";

function extract(source: string) {
  return extractRscMiddlewareConfigModule(source, parseAst(source) as never);
}

describe("RSC middleware config extraction", () => {
  it("keeps middleware closures while dropping build-only config imports", () => {
    const source = `
import { defineConfig } from "@farm.js/core";
import farmRsc from "@farm.js/plugin/rsc";
const headerName = "x-config-middleware";
export default defineConfig({
  plugins: [farmRsc()],
  middleware: {
    matcher: /^\\/private/,
    handler(context) {
      context.headers.set(headerName, "active");
    },
  },
});`;

    const result = extract(source);
    expect(result.kind).toBe("module");
    if (result.kind !== "module") return;
    expect(result.code).toContain('const headerName = "x-config-middleware";');
    expect(result.code).toContain("context.headers.set(headerName");
    expect(result.code).not.toContain("@farm.js/plugin/rsc");
    expect(result.code).not.toContain("defineConfig");
  });

  it("retains only imported bindings reachable from middleware", () => {
    const source = `
import { middlewareHandler, vitePlugin } from "./helpers.js";
const handler = (context) => middlewareHandler(context);
const plugin = vitePlugin();
export default {
  plugins: [plugin],
  middleware: { matcher: "/private", handler },
};`;

    const result = extract(source);
    expect(result.kind).toBe("module");
    if (result.kind !== "module") return;
    expect(result.code).toContain('import { middlewareHandler } from "./helpers.js";');
    expect(result.code).toContain("const handler = (context) => middlewareHandler(context);");
    expect(result.code).not.toContain("vitePlugin");
    expect(result.code).not.toContain("const plugin");
  });

  it("rejects a spread that can replace the extracted middleware", () => {
    const source = `
const shared = {};
export default { middleware: { matcher: "/private" }, ...shared };`;

    expect(extract(source)).toEqual({
      kind: "unsupported",
      reason: "a config spread after middleware may override it",
    });
  });

  it("rejects a top-level statement that changes the middleware matcher", () => {
    const source = `
import { defineConfig } from "@farm.js/core";
const matcher = [];
matcher.push("/admin");
export default defineConfig({
  middleware: { matcher, handler() {} },
});`;

    expect(extract(source)).toEqual({
      kind: "unsupported",
      reason:
        'the top-level statement `matcher.push("/admin");` would not run with the extracted middleware',
    });
  });

  it("rejects middleware assigned after the config object is built", () => {
    const source = `
const config = { middleware: [] };
config.middleware.push({ matcher: "/admin", handler() {} });
export default config;`;

    expect(extract(source)).toMatchObject({ kind: "unsupported" });
  });

  it("rejects a side-effect import the extracted module would drop", () => {
    const source = `
import "./register-guards.js";
export default { middleware: { matcher: "/admin", handler() {} } };`;

    expect(extract(source)).toEqual({
      kind: "unsupported",
      reason:
        'the side-effect import `import "./register-guards.js";` would not run with the extracted middleware',
    });
  });

  it("keeps directives, re-exports and declaration-only configs working", () => {
    const source = `
"use strict";
import { defineConfig } from "@farm.js/core";
export * from "./shared.js";
export const matcher = ["/admin"];
function handler() {}
class Guard {}
export default defineConfig({ middleware: { matcher, handler } });`;

    const result = extract(source);
    expect(result.kind).toBe("module");
    if (result.kind !== "module") return;
    expect(result.code).toContain('const matcher = ["/admin"];');
    expect(result.code).toContain("function handler() {}");
  });
});

describe("RSC mcp config extraction", () => {
  function extractMcp(source: string) {
    return extractRscConfigPropertyModule(source, parseAst(source) as never, "mcp");
  }

  it("keeps the mcp tools from a Vite config without its plugins", () => {
    const source = `
import tailwindcss from "@tailwindcss/vite";
import rsc from "@vitejs/plugin-rsc";
import { defineConfig, nitro } from "@farm.js/plugin/rsc";
import { productQuery } from "./src/actions/server-query.ts";
import { GET as listUsers } from "./src/api/users/route.ts";
const nitroPreset = process.env.NITRO_PRESET || "vercel";
export default defineConfig({
  srcDir: "src",
  mcp: {
    name: "demo",
    tools: [{ endpoint: listUsers, name: "list_users" }, productQuery],
  },
  plugins: [tailwindcss(), rsc(), nitro({ config: { preset: nitroPreset } })],
});`;

    const result = extractMcp(source);
    expect(result.kind).toBe("module");
    if (result.kind !== "module") return;
    expect(result.code).toContain('import { productQuery } from "./src/actions/server-query.ts";');
    expect(result.code).toContain('import { GET as listUsers } from "./src/api/users/route.ts";');
    expect(result.code).toContain("export default { mcp: {");
    for (const dropped of ["tailwindcss", "plugin-rsc", "nitroPreset", "defineConfig"]) {
      expect(result.code).not.toContain(dropped);
    }
  });

  it("reports a config without mcp as absent and a spread as ambiguous", () => {
    expect(extractMcp("export default { srcDir: 'src' };").kind).toBe("absent");
    expect(extractMcp("const base = {};\nexport default { ...base };")).toEqual({
      kind: "unsupported",
      reason: "mcp may be supplied through a config spread",
    });
  });
});
