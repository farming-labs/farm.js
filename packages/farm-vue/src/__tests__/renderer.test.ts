// @vitest-environment node

import { Writable } from "node:stream";
import {
  defineRendererDescriptorConformance,
  defineRendererServerConformance,
} from "@farm.js/renderer-tests";
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import { vue } from "../index";
import * as serverRuntime from "../server";
import {
  createElement,
  generateHydrationScript,
  renderToPipeableStream,
  renderToReadableStream,
  renderToString,
} from "../server";

defineRendererDescriptorConformance({
  name: "vue",
  createDescriptor: vue,
  expected: {
    vite: "@farm.js/vue/vite",
    server: "@farm.js/vue/server",
    client: "@farm.js/vue/client",
    componentExtensions: [".vue"],
    buildConcurrency: "serial",
    capabilities: { streaming: { node: true, web: true } },
  },
});

defineRendererServerConformance(serverRuntime);

describe("Vue renderer", () => {
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

  it("materializes plain function components before handing them to Vue", async () => {
    const Layout = ({ children }: { children?: unknown }) =>
      createElement("section", { class: "function-layout" }, children);

    const html = await renderToString(
      createElement(Layout, { children: createElement("p", null, "Function route") }),
    );

    expect(html).toContain('<section class="function-layout"><p>Function route</p></section>');
  });

  it("reports async function components instead of rendering a promise", async () => {
    const AsyncComponent = async () => createElement("p", null, "not supported");

    await expect(renderToString(createElement(AsyncComponent, null))).rejects.toThrow(
      "does not support async function components",
    );
  });

  it("reports a render error as a shell error", async () => {
    const Boom = defineComponent({
      setup: () => () => {
        throw new Error("vue shell boom");
      },
    });

    const outcome = await new Promise<string>((resolve) => {
      const stream = renderToPipeableStream(createElement(Boom, null), {
        onShellReady() {
          resolve("shell-ready");
        },
        onShellError() {
          resolve("shell-error");
        },
        onError() {
          resolve("error");
        },
      });
      void stream;
    });

    expect(outcome).toBe("shell-error");
  });

  it("settles the piped destination when the render errors instead of hanging", async () => {
    const Boom = defineComponent({
      setup: () => () => {
        throw new Error("vue stream boom");
      },
    });

    // Mirror core's buffered pipeable consumer: pipe on shell-ready, and let the
    // Writable's finish/error be the only way the promise settles. A regression
    // (error not forwarded to the destination) would hang until the test times out.
    const outcome = await new Promise<string>((resolve, reject) => {
      const destination = new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
      let started = false;
      destination.once("finish", () => resolve("finish"));
      destination.once("error", () => resolve("destination-error"));

      const stream = renderToPipeableStream(createElement(Boom, null), {
        onShellReady() {
          started = true;
          stream.pipe(destination);
        },
        onShellError(error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        },
        onError() {
          if (!started) reject(new Error("errored before shell"));
        },
      });
    }).catch((error: Error) => `shell-error:${error.message}`);

    // Either classification is acceptable; the point is that it settles.
    expect(outcome).toMatch(/^(destination-error|shell-error:)/);
  }, 5000);

  it("does not require a renderer-specific hydration bootstrap", () => {
    expect(generateHydrationScript()).toBe("");
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
