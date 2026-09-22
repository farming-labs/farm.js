// @vitest-environment node

import {
  defineRendererDescriptorConformance,
  defineRendererServerConformance,
} from "@farm.js/renderer-tests";
import { describe, expect, it } from "vitest";
import { svelte } from "../index";
import * as serverRuntime from "../server";
import {
  createElement,
  generateHydrationScript,
  markFunctionComponent,
  renderToString,
} from "../server";

defineRendererDescriptorConformance({
  name: "svelte",
  createDescriptor: svelte,
  expected: {
    vite: "@farm.js/svelte/vite",
    server: "@farm.js/svelte/server",
    client: "@farm.js/svelte/client",
    componentExtensions: [".svelte"],
    capabilities: {
      streaming: { node: false, web: false },
      functionComponents: true,
    },
  },
});

defineRendererServerConformance(serverRuntime);

describe("Svelte renderer", () => {
  it("renders FARMJS elements with Svelte's server runtime", async () => {
    const html = await renderToString(
      createElement(
        "main",
        { className: "svelte-app", style: { display: "contents", WebkitFontSmoothing: "auto" } },
        createElement("h1", null, "Hello from Svelte"),
      ),
    );

    expect(html).toContain('class="svelte-app"');
    expect(html).toContain('style="display: contents; -webkit-font-smoothing: auto"');
    expect(html).toContain("<h1>");
    expect(html).toContain("Hello from Svelte");
  });

  it("renders dangerouslySetInnerHTML as element content, not an attribute", async () => {
    const html = await renderToString(
      createElement("div", {
        className: "rich",
        dangerouslySetInnerHTML: { __html: "<b>bold</b> and <em>italic</em>" },
      }),
    );

    expect(html).toContain("<b>bold</b> and <em>italic</em>");
    expect(html).toContain('class="rich"');
    // The raw HTML must not leak into an escaped innerhtml="..." attribute.
    expect(html).not.toMatch(/innerhtml=/i);
    expect(html).not.toContain("&lt;b&gt;");
  });

  it("does not require a renderer-specific hydration bootstrap", () => {
    expect(generateHydrationScript()).toBe("");
  });

  it("calls a marked function component instead of mounting it as a Svelte component", async () => {
    const Provider = markFunctionComponent((props: Record<string, unknown>) =>
      createElement(
        "section",
        { className: "provider", "data-tenant": props.tenant },
        props.children,
      ),
    );

    const html = await renderToString(
      createElement(Provider, { tenant: "acme" }, createElement("p", null, "wrapped")),
    );

    expect(html).toContain('class="provider"');
    expect(html).toContain('data-tenant="acme"');
    expect(html).toContain("<p>");
    expect(html).toContain("wrapped");
  });

  it("gives a marked function component its props unnormalized", async () => {
    const seen: Record<string, unknown>[] = [];
    const Probe = markFunctionComponent((props: Record<string, unknown>) => {
      seen.push(props);
      return createElement("div", null, "probe");
    });

    await renderToString(createElement(Probe, { className: "raw", onClick: () => {} }));

    expect(seen).toHaveLength(1);
    // A function component is React-shaped: it reads className/onClick itself,
    // so compat-root must not translate them the way it does for DOM elements.
    expect(seen[0]).toHaveProperty("className", "raw");
    expect(seen[0]).toHaveProperty("onClick");
    expect(seen[0]).not.toHaveProperty("class");
  });

  it("renders a marked function component nested inside another", async () => {
    const Inner = markFunctionComponent((props: Record<string, unknown>) =>
      createElement("span", { className: "inner" }, props.children),
    );
    const Outer = markFunctionComponent((props: Record<string, unknown>) =>
      createElement("div", { className: "outer" }, createElement(Inner, null, props.children)),
    );

    const html = await renderToString(createElement(Outer, null, "deep"));

    expect(html).toContain('class="outer"');
    expect(html).toContain('class="inner"');
    expect(html).toContain("deep");
  });

  it("carries svelte:head markup through renderToStringWithHead", async () => {
    const { mkdir, rm, writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath, pathToFileURL } = await import("node:url");
    const { compile } = await import("svelte/compiler");

    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    const fixtureDirectory = path.join(testDirectory, ".head-fixture");
    await mkdir(fixtureDirectory, { recursive: true });
    try {
      const source = [
        "<svelte:head>",
        "  <title>Docs Page</title>",
        '  <meta name="description" content="from svelte head" />',
        "</svelte:head>",
        "<h1>Docs body</h1>",
      ].join("\n");
      const compiled = compile(source, {
        filename: "head-page.svelte",
        generate: "server",
        css: "external",
      });
      const modulePath = path.join(fixtureDirectory, "head-page.js");
      await writeFile(modulePath, compiled.js.code);
      const { default: HeadPage } = await import(pathToFileURL(modulePath).href);

      const { renderToStringWithHead } = await import("../server");
      const rendered = await renderToStringWithHead(createElement(HeadPage));

      expect(rendered.html).toContain("Docs body");
      expect(rendered.html).not.toContain("Docs Page");
      expect(rendered.head).toContain("<title>Docs Page</title>");
      expect(rendered.head).toContain('content="from svelte head"');

      // The body-only export stays unchanged for callers without a head channel.
      const bodyOnly = await renderToString(createElement(HeadPage));
      expect(bodyOnly).toBe(rendered.html);
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it("emits numeric scale without a px unit, matching React's unitless set", async () => {
    const html = await renderToString(
      createElement("div", { style: { scale: 1.5, opacity: 0.5, width: 100, zIndex: 3 } }),
    );

    expect(html).toMatch(/scale:\s*1\.5(?!px)/);
    expect(html).not.toMatch(/scale:\s*1\.5px/);
    expect(html).toMatch(/opacity:\s*0?\.5(?!px)/);
    expect(html).toMatch(/z-index:\s*3(?!px)/);
    expect(html).toMatch(/width:\s*100px/);
  });

  it("keeps translate and rotate unit-bearing, matching React's unitless set", async () => {
    const html = await renderToString(
      createElement("div", { style: { translate: 10, rotate: 45 } }),
    );

    expect(html).toMatch(/translate:\s*10px/);
    expect(html).toMatch(/rotate:\s*45px/);
  });
});
