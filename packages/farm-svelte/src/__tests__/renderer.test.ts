// @vitest-environment node

import { describe, expect, it } from "vitest";
import { svelte } from "../index";
import { createElement, generateHydrationScript, renderToString } from "../server";

describe("Svelte renderer", () => {
  it("returns an isolated renderer descriptor", () => {
    const first = svelte();
    const second = svelte();

    expect(first).toMatchObject({
      name: "svelte",
      vite: "@farm.js/svelte/vite",
      server: "@farm.js/svelte/server",
      client: "@farm.js/svelte/client",
      capabilities: { streaming: { node: false, web: false } },
      componentExtensions: [".svelte"],
    });
    expect(first.componentExtensions).not.toBe(second.componentExtensions);
    expect(first.dedupe).not.toBe(second.dedupe);
    expect(first.optimizeDeps).not.toBe(second.optimizeDeps);
  });

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
});
