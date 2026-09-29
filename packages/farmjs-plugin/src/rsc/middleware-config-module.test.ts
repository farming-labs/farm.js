import { parseAst } from "vite";
import { describe, expect, it } from "vitest";
import { extractRscMiddlewareConfigModule } from "./middleware-config-module.js";

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
});
