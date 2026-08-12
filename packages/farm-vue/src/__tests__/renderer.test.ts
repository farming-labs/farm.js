// @vitest-environment node

import {
  defineRendererDescriptorConformance,
  defineRendererServerConformance,
} from "@farm.js/renderer-tests";
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import { vue } from "../index";
import * as serverRuntime from "../server";
import { createElement, generateHydrationScript, renderToString } from "../server";

defineRendererDescriptorConformance({
  name: "vue",
  createDescriptor: vue,
  expected: {
    vite: "@farm.js/vue/vite",
    server: "@farm.js/vue/server",
    client: "@farm.js/vue/client",
    componentExtensions: [".vue"],
    capabilities: { streaming: { node: false, web: false } },
  },
});

defineRendererServerConformance(serverRuntime);

describe("Vue renderer", () => {
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
