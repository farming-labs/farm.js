// @vitest-environment node

import {
  defineRendererDescriptorConformance,
  defineRendererServerConformance,
} from "@farm.js/renderer-tests";
import { describe, expect, it } from "vitest";
import { svelte } from "../index";
import * as serverRuntime from "../server";
import { createElement, generateHydrationScript, renderToString } from "../server";

defineRendererDescriptorConformance({
  name: "svelte",
  createDescriptor: svelte,
  expected: {
    vite: "@farm.js/svelte/vite",
    server: "@farm.js/svelte/server",
    client: "@farm.js/svelte/client",
    componentExtensions: [".svelte"],
    capabilities: { streaming: { node: false, web: false } },
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

  it("does not require a renderer-specific hydration bootstrap", () => {
    expect(generateHydrationScript()).toBe("");
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
});
