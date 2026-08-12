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
});
