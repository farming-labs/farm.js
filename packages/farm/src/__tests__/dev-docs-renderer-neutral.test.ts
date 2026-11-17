// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as reactServerRuntime from "../renderer/react/server";
import { REACT_RENDERER, resolveFarmRenderer } from "../renderer";

const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitePluginSource = readFileSync(path.join(sourceDir, "vite.ts"), "utf8");
const serverRendererSource = readFileSync(path.join(sourceDir, "server", "renderer.ts"), "utf8");

/** A method of the dev ServerRenderer, from its signature to its closing brace. */
function rendererMethodSource(signature: string): string {
  const start = serverRendererSource.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  // Past the parameter list, whose defaults and types hold braces too: the body opens the line.
  let parens = 0;
  let paramsEnd = serverRendererSource.indexOf("(", start);
  for (; ; paramsEnd++) {
    if (serverRendererSource[paramsEnd] === "(") parens++;
    else if (serverRendererSource[paramsEnd] === ")" && --parens === 0) break;
  }
  let depth = 0;
  for (let index = serverRendererSource.indexOf("{\n", paramsEnd); ; index++) {
    expect(index).toBeLessThan(serverRendererSource.length);
    if (serverRendererSource[index] === "{") depth++;
    else if (serverRendererSource[index] === "}" && --depth === 0) {
      return serverRendererSource.slice(start, index + 1);
    }
  }
}

/** The docs dev handler: the dev ServerRenderer composes and renders docs pages' layouts. */
function docsHandlerSource(): string {
  return rendererMethodSource(
    "async wrapDocsResponseWithLayouts(request: Request, response: Response): Promise<Response> {",
  );
}

/** Where the renderer's server runtime is loaded, once, for app pages and docs pages alike. */
function runtimeLoaderSource(): string {
  return rendererMethodSource("async initialize(): Promise<void> {");
}

describe("dev docs renders through the configured renderer", () => {
  it("hands docs pages to the dev renderer", () => {
    // vite.ts holds no renderer of its own for docs pages.
    expect(vitePluginSource).toContain(
      "farmApp.getServerRenderer().wrapDocsResponseWithLayouts(request, response)",
    );
    expect(vitePluginSource).not.toContain("const docsRenderer = resolveFarmRenderer(");
  });

  it("does not reach for react or react-dom/server directly", () => {
    // The production entry resolves the renderer's own server module. Dev
    // importing react literally is what made a Solid or Vue layout get
    // composed and rendered by React in development only.
    for (const source of [docsHandlerSource(), runtimeLoaderSource()]) {
      expect(source).not.toContain('import("react")');
      expect(source).not.toContain('import("react-dom/server")');
      expect(source).not.toMatch(/\bReactDOMServer\./);
      expect(source).not.toMatch(/\bReact\.createElement\(/);
    }
  });

  it("loads the renderer's server module for a non-React renderer", () => {
    // The handler renders with the runtime initialize() loads before it reads it.
    expect(docsHandlerSource()).toContain("await this.initialize();");
    const loader = runtimeLoaderSource();
    expect(loader).toContain("loadFarmDevModule(this.viteServer, this.config.renderer.server)");
    // React keeps its built-in runtime rather than going through Vite.
    expect(loader).toContain("isReactRenderer(this.config.renderer)");
    expect(loader).toContain('import("../renderer/react/server")');
    expect(loader).toContain("this.rendererRuntime =");
  });

  it("composes and renders through that one runtime", () => {
    const source = docsHandlerSource();
    expect(source).toContain("createFarmDocsLayoutTree(this.rendererRuntime, {");
    expect(source).toContain("this.rendererRuntime.createElement(");
    expect(source).toContain("await this.renderElementToDocumentParts(");
    // The document renderer renders with the same runtime's own string renderers.
    const render = rendererMethodSource("private async renderElementToDocumentParts(");
    expect(render).toContain("this.rendererRuntime.renderToStringWithHead(");
    expect(render).toContain("await this.renderElementToCompleteHTML(element, options)");
    const complete = rendererMethodSource("private async renderElementToCompleteHTML(");
    expect(complete).toContain("this.rendererRuntime.renderToPipeableStream");
    expect(complete).toContain("this.rendererRuntime.renderToString(");
    expect(complete).not.toContain('import("react-dom/server")');
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
