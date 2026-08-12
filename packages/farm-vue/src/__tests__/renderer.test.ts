// @vitest-environment node

import { Writable } from "node:stream";
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import { vue } from "../index";
import {
  createElement,
  generateHydrationScript,
  renderToPipeableStream,
  renderToReadableStream,
  renderToString,
} from "../server";

describe("Vue renderer", () => {
  it("returns an isolated renderer descriptor", () => {
    const first = vue();
    const second = vue();

    expect(first).toMatchObject({
      name: "vue",
      vite: "@farm.js/vue/vite",
      server: "@farm.js/vue/server",
      client: "@farm.js/vue/client",
      capabilities: { streaming: { node: true, web: true } },
      componentExtensions: [".vue"],
    });
    expect(first.componentExtensions).not.toBe(second.componentExtensions);
    expect(first.dedupe).not.toBe(second.dedupe);
    expect(first.optimizeDeps).not.toBe(second.optimizeDeps);
  });

  it("streams FARMJS elements through Vue's Node adapter", async () => {
    const html = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const destination = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          callback();
        },
      });
      destination.once("finish", () => resolve(Buffer.concat(chunks).toString("utf8")));
      destination.once("error", reject);

      const stream = renderToPipeableStream(createElement("p", null, "Streamed from Vue"), {
        onShellReady() {
          stream.pipe(destination);
        },
        onShellError: reject,
        onError: reject,
      });
    });

    expect(html).toContain("<p>Streamed from Vue</p>");
  });

  it("streams FARMJS elements through Vue's Web adapter", async () => {
    const stream = renderToReadableStream(createElement("p", null, "Vue Web stream"));

    await expect(new Response(stream).text()).resolves.toContain("<p>Vue Web stream</p>");
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
