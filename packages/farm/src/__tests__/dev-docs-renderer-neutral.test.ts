// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as reactServerRuntime from "../renderer/react/server";
import { REACT_RENDERER, resolveFarmRenderer } from "../renderer";

const vitePluginSource = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../vite.ts"),
  "utf8",
);

/** The docs dev handler, from where it resolves the renderer to where it renders. */
function docsHandlerSource(): string {
  const start = vitePluginSource.indexOf("const docsRenderer = resolveFarmRenderer(");
  const end = vitePluginSource.indexOf("const html = source.replace(bodyMatch[0]", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return vitePluginSource.slice(start, end);
}

describe("dev docs renders through the configured renderer", () => {
  it("does not reach for react or react-dom/server directly", () => {
    // The production entry resolves the renderer's own server module. Dev
    // importing react literally is what made a Solid or Vue layout get
    // composed and rendered by React in development only.
    const source = docsHandlerSource();
    expect(source).not.toContain('import("react")');
    expect(source).not.toContain('import("react-dom/server")');
    expect(source).not.toMatch(/\bReactDOMServer\./);
  });

  it("loads the renderer's server module for a non-React renderer", () => {
    const source = docsHandlerSource();
    expect(source).toContain("server.ssrLoadModule(docsRenderer.server)");
    // React keeps its built-in runtime rather than going through Vite.
    expect(source).toContain("isReactRenderer(docsRenderer)");
    expect(source).toContain('import("./renderer/react/server")');
  });

  it("composes and renders through that one runtime", () => {
    const source = docsHandlerSource();
    expect(source).toContain("rendererRuntime.createElement(");
    expect(source).toContain("await rendererRuntime.renderToString(");
  });

  it("the React runtime satisfies the shape the handler uses", () => {
    // The handler treats one module namespace as both the element factory and
    // the string renderer, which the renderer contract requires of every
    // server module.
    expect(typeof reactServerRuntime.createElement).toBe("function");
    expect(typeof reactServerRuntime.renderToString).toBe("function");
  });

  it("a non-React descriptor points at its own server module", () => {
    const solid = resolveFarmRenderer({
      name: "solid",
      vite: "@farm.js/solid/vite",
      server: "@farm.js/solid/server",
      client: "@farm.js/solid/client",
    });
    expect(solid.server).toBe("@farm.js/solid/server");
    expect(resolveFarmRenderer(undefined).server).toBe(REACT_RENDERER.server);
  });
});
