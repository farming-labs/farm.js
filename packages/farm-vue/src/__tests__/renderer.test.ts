// @vitest-environment node

import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import { vue } from "../index";
import { createElement, generateHydrationScript, renderToString } from "../server";

describe("Vue renderer", () => {
  it("returns an isolated renderer descriptor", () => {
    const first = vue();
    const second = vue();

    expect(first).toMatchObject({
      name: "vue",
      vite: "@farm.js/vue/vite",
      server: "@farm.js/vue/server",
      client: "@farm.js/vue/client",
      capabilities: { streaming: { node: false, web: false } },
      componentExtensions: [".vue"],
    });
    expect(first.componentExtensions).not.toBe(second.componentExtensions);
    expect(first.dedupe).not.toBe(second.dedupe);
    expect(first.optimizeDeps).not.toBe(second.optimizeDeps);
  });

  it("renders FARMJS elements with Vue's server runtime", async () => {
    const html = await renderToString(
      createElement("main", { className: "vue-app" }, createElement("h1", null, "Hello from Vue")),
    );

    expect(html).toContain('<main class="vue-app">');
    expect(html).toContain("<h1>Hello from Vue</h1>");
  });

  it("passes FARMJS children through Vue's default slot", async () => {
    const Layout = defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          h("section", { class: "layout" }, slots.default?.()),
    });

    const html = await renderToString(
      createElement(Layout, {
        children: createElement("p", null, "Nested route"),
      }),
    );

    expect(html).toContain('<section class="layout"><p>Nested route</p></section>');
  });

  it("does not require a renderer-specific hydration bootstrap", () => {
    expect(generateHydrationScript()).toBe("");
  });
});
