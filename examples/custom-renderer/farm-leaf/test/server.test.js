// @vitest-environment node

import {
  defineRendererDescriptorConformance,
  defineRendererServerConformance,
} from "@farm.js/renderer-tests";
import { createElement } from "leaf";
import { describe, expect, it, vi } from "vitest";
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
      "<p>{count}</p>",
    ].join("\n");
    const compiled = compileLeaf(source, componentName("src/app/[name]/page.leaf"));
    expect(compiled).toMatch(/^import \{ useState \} from "leaf";/);
    expect(compiled).toContain("export const hydrate = true;");
    expect(compiled).toContain("export default function Page(props) {");
    expect(compiled).toContain("const [count] = useState(1);");
    expect(compiled).toContain("return (<><p>{count}</p></>);");
  });
});

describe("leaf islands", () => {
  function Counter(props) {
    return createElement("button", null, `${props.label}: 0`);
  }
  const reference = { src: "/src/components/counter.tsx", export: "Counter", strategy: "idle" };
  const Island = server.withIsland(Counter, reference);

  it("writes a client component from server output as an island, with its strategy", async () => {
    const html = await server.renderToString(
      createElement(Island, { label: "Plant", "client:visible": true }),
    );
    expect(html).toMatch(
      /^<f-island src="\/src\/components\/counter\.tsx" export="Counter" props="(fi-?\d+)" strategy="visible" style="display:contents"><button>Plant: 0<\/button><\/f-island><script type="[^"]+" for="\1">/,
    );
    // client:* sets the strategy and never reaches the component.
    expect(html).toContain('{"label":"Plant"}');
  });

  it("uses the module's strategy without a client:* attribute", async () => {
    const html = await server.renderToString(createElement(Island, { label: "Plant" }));
    expect(html).toContain('strategy="idle"');
  });

  it("renders the component plain inside a tree that hydrates as one root", async () => {
    const html = await server.renderToString(
      server.wrapClientGraph(createElement(Island, { label: "Plant", "client:load": true })),
    );
    expect(html).toBe("<button>Plant: 0</button>");
  });

  it("starts islands again in a server page that root keeps as HTML", async () => {
    const html = await server.renderToString(
      server.wrapClientGraph(
        createElement(
          "main",
          null,
          server.isolateServerPageGraph(createElement(Island, { label: "Plant" })),
        ),
      ),
    );
    expect(html).toMatch(/^<main><f-island [^>]*><button>Plant: 0<\/button><\/f-island><script /);
  });

  it("keeps the server HTML without an island when a prop can't reach the browser", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const html = await server.renderToString(
        createElement(Island, { label: "Plant", onPlant: function onPlant() {} }),
      );
      expect(html).toBe("<button>Plant: 0</button>");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("onPlant"));
    } finally {
      warn.mockRestore();
    }
  });

  it("leaves an export that isn't a component as it is", () => {
    expect(server.withIsland("idle", reference)).toBe("idle");
  });
});
