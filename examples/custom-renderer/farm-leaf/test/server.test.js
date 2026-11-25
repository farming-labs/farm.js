// @vitest-environment node

import {
  defineRendererDescriptorConformance,
  defineRendererIslandsConformance,
  defineRendererServerConformance,
  defineRendererSourceConformance,
} from "@farm.js/renderer-tests";
import { createElement } from "leaf";
import { describe, expect, it } from "vitest";
import { compileLeaf, componentName } from "../src/compile.js";
import { leaf } from "../src/index.js";
import * as server from "../src/server.js";

defineRendererDescriptorConformance({
  name: "leaf",
  createDescriptor: leaf,
  expected: {
    vite: "farm-leaf/vite",
    server: "farm-leaf/server",
    client: "farm-leaf/client",
    jsxImportSource: "leaf",
    capabilities: {
      streaming: { node: false, web: true },
      reconcilesRerenders: true,
      functionComponents: true,
      hydrationFallback: true,
      islands: true,
    },
  },
});

defineRendererServerConformance(server);

describe("leaf/server streaming", () => {
  const decoder = new TextDecoder();

  it("sends what's before a Suspense boundary before an async component inside it resolves", async () => {
    let open;
    const gate = new Promise((resolve) => (open = resolve));
    async function Report() {
      await gate;
      return createElement("p", null, "report");
    }
    const stream = server.renderToReadableStream(
      createElement(
        "main",
        null,
        createElement("p", null, "first"),
        createElement(server.Suspense, null, createElement(Report, null)),
      ),
    );
    const reader = stream.getReader();

    expect(decoder.decode((await reader.read()).value)).toBe("<main><p>first</p>");
    open();
    expect(decoder.decode((await reader.read()).value)).toBe("<p>report</p></main>");
    expect((await reader.read()).done).toBe(true);
  });

  it("reports a failure after output to onError and ends the stream", async () => {
    const errors = [];
    async function Broken() {
      throw new Error("failed after the boundary");
    }
    const stream = server.renderToReadableStream(
      createElement(
        "main",
        null,
        "first",
        createElement(server.Suspense, null, createElement(Broken, null)),
      ),
      { onError: (error) => errors.push(error.message) },
    );

    expect(await new Response(stream).text()).toBe("<main>first");
    expect(errors).toEqual(["failed after the boundary"]);
  });

  it("waits for an async component outside a boundary before the first chunk", async () => {
    async function Title() {
      return createElement("h1", null, "title");
    }
    const stream = server.renderToReadableStream(
      createElement("main", null, createElement(Title, null)),
    );
    expect(await new Response(stream).text()).toBe("<main><h1>title</h1></main>");
  });
});

describe("leaf files", () => {
  it("compile to a module whose default export is the component", () => {
    const source = [
      "<script module>",
      "export const hydrate = true;",
      "</script>",
      "<script>",
      'import { useState } from "leaf";',
      "const [count] = useState(1);",
      "</script>",
      "<p>{{ count }}</p>",
    ].join("\n");
    const compiled = compileLeaf(source, componentName("src/app/[name]/page.leaf"));
    expect(compiled).toMatch(/^import \{ useState \} from "leaf";/);
    expect(compiled).toContain("export const hydrate = true;");
    expect(compiled).toContain("export default function Page(props) {");
    expect(compiled).toContain("const [count] = useState(1);");
    expect(compiled).toContain("return (<><p>{count}</p></>);");
  });
});

// withIsland, wrapClientGraph and isolateServerPageGraph, the exports capabilities.islands needs.
defineRendererIslandsConformance({ name: "leaf", server });

// The descriptor's routes(), hydration.resolve() and compile(), on .leaf files like the example
// app's.
defineRendererSourceConformance({
  name: "leaf",
  createDescriptor: leaf,
  files: [
    { path: "src/app/page.leaf", route: { kind: "page", pattern: "/" } },
    { path: "src/app/about/page.tsx", route: { kind: "page", pattern: "/about" } },
    { path: "src/app/crops/[name]/page.leaf", route: { kind: "page", pattern: "/crops/[name]" } },
    { path: "src/app/not-found.leaf", route: { kind: "not-found", pattern: "/" } },
    { path: "src/app/guides/index.leaf", route: { kind: "page", pattern: "/guides" } },
    { path: "src/app/guides/[crop].leaf", route: { kind: "page", pattern: "/guides/[crop]" } },
    { path: "src/app/guides/_layout.leaf", route: { kind: "layout", pattern: "/guides" } },
    { path: "src/app/guides/_tip.leaf", route: null },
    { path: "src/app/guides/notes.tsx", route: null },
    {
      path: "src/app/guides/watering.client.leaf",
      route: { kind: "page", pattern: "/guides/watering", hydrate: true },
    },
    {
      path: "src/app/guides/harvest.leaf",
      source: "<script module>\n  // @hydrate interaction\n</script>\n\n<p>Harvest</p>\n",
      route: { kind: "page", pattern: "/guides/harvest" },
      hydration: { hydrate: true, strategy: "interaction" },
      client: false,
    },
    {
      path: "src/app/guides/fences.leaf",
      source: "<script module>\n  // @hydrate false\n</script>\n\n<p>Fences</p>\n",
      hydration: { hydrate: false },
    },
    {
      path: "src/app/notes/page.leaf",
      source: "<script module>\n  export const hydrate = true;\n</script>\n\n<p>Notes</p>\n",
      hydration: null,
      client: false,
    },
    {
      path: "src/components/planter.leaf",
      source:
        '<script module>\n  "use client";\n\n  // A client component.\n  export const island = "load";\n</script>\n\n<button>{{ props.crop }}</button>\n',
      client: true,
    },
  ],
});
