// @vitest-environment node

import React from "react";
import { describe, expect, it } from "vitest";
import {
  createFarmMetadataImageResponse,
  resolveFarmMetadataImageValue,
  type FarmMetadataImageRenderer,
} from "../metadata-image";

/**
 * Satori reads React-shaped elements. Vue, Solid, and Svelte elements keep their children outside
 * `props`, and their components aren't plain functions, so a metadata image from any renderer but
 * React renders to HTML with that renderer first. This renderer returns the markup it's given, in
 * the shapes those renderers write: hydration comments, escaped text, and serialized styles.
 */
function markupRenderer(markup: string): FarmMetadataImageRenderer {
  return {
    createElement: (type, props, ...children) => ({ $$markup: true, type, props, children }),
    // Vue's and Solid's accept any value, so the image must not rely on this to spot bodies.
    isValidElement: (value) => value !== null && value !== undefined,
    renderToString: async () => markup,
  };
}

const size = { size: { width: 300, height: 150 } };
const backgroundImage =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 2'><rect width='1' height='1' fill='red'/></svg>\")";

function ReactCard() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "#000",
        color: "#fff",
        padding: 12,
        backgroundImage,
      }}
    >
      <span style={{ fontSize: 40, fontWeight: 700 }}>Hello OG &amp; co</span>
      <div className="flex text-xl text-emerald-400">rows: 12</div>
    </div>
  );
}

async function png(value: unknown, renderer?: FarmMetadataImageRenderer): Promise<Buffer> {
  const response = await createFarmMetadataImageResponse(value, size, { renderer });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  return Buffer.from(await response.arrayBuffer());
}

describe("metadata images from a renderer's markup", () => {
  it.each([
    [
      "Vue",
      `<div style="display: flex; flex-direction: column; width: 100%; height: 100%; background: #000; color: #fff; padding: 12px; background-image: url(&quot;data:image/svg+xml;utf8,&lt;svg xmlns=&#39;http://www.w3.org/2000/svg&#39; viewBox=&#39;0 0 2 2&#39;&gt;&lt;rect width=&#39;1&#39; height=&#39;1&#39; fill=&#39;red&#39;/&gt;&lt;/svg&gt;&quot;)"><!--[--><span style="font-size: 40px; font-weight: 700">Hello OG &amp; co</span><!--]--><div class="flex text-xl text-emerald-400">rows: 12</div></div>`,
    ],
    [
      "Svelte",
      `<!--[--><!----><div style="display: flex; flex-direction: column; width: 100%; height: 100%; background: #000; color: #fff; padding: 12px; background-image: url(&quot;data:image/svg+xml;utf8,&lt;svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 2'>&lt;rect width='1' height='1' fill='red'/>&lt;/svg>&quot;)">
  <span style="font-size: 40px; font-weight: 700"><!--[-->Hello OG<!--]--> &amp; co</span>
  <div class="flex text-xl text-emerald-400"><!--[2-->rows: <!--]--><!--[2-->12<!--]--></div>
</div><!--]-->`,
    ],
    [
      "Solid",
      `<div data-hk="20" style="display:flex;flex-direction:column;width:100%;height:100%;background:#000;color:#fff;padding:12px;background-image:url(&quot;data:image/svg+xml;utf8,&lt;svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 2'>&lt;rect width='1' height='1' fill='red'/>&lt;/svg>&quot;) !important"><span data-hk="10" style="font-size:40px;font-weight:700">Hello OG<!--$--> &#38; co<!--/--></span><div class="flex text-xl text-emerald-400">rows: <!--$-->12<!--/--></div></div>`,
    ],
  ])("renders %s's markup as the same PNG React renders", async (_name, markup) => {
    const element = { $$markup: true, type: "div", props: null, children: [] };

    expect(await png(element, markupRenderer(markup))).toEqual(await png(<ReactCard />));
  });

  it("treats strings and bytes as image bodies when the renderer's isValidElement accepts them", async () => {
    const renderer = markupRenderer("<div>never rendered</div>");

    const bytes = await createFarmMetadataImageResponse(
      new Uint8Array([1, 2, 3]),
      { contentType: "image/png" },
      { renderer },
    );
    expect(Buffer.from(await bytes.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));

    const svg = await createFarmMetadataImageResponse(
      "<svg xmlns='http://www.w3.org/2000/svg'/>",
      { contentType: "image/svg+xml" },
      { renderer },
    );
    expect(await svg.text()).toBe("<svg xmlns='http://www.w3.org/2000/svg'/>");
  });

  it("still renders a React element directly under another renderer", async () => {
    const renderer = markupRenderer("<p>not this</p>");

    expect(await png(<ReactCard />, renderer)).toEqual(await png(<ReactCard />));
  });

  it("lets a renderer claim its own elements that carry React's marker, as preact/compat's do", async () => {
    const markup = `<div style="display:flex;flex-direction:column;width:100%;height:100%;background:#000;color:#fff;padding:12px;background-image:url(&quot;data:image/svg+xml;utf8,&lt;svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 2'>&lt;rect width='1' height='1' fill='red'/>&lt;/svg>&quot;)"><span style="font-size:40px;font-weight:700">Hello OG &amp; co</span><div class="flex text-xl text-emerald-400">rows: 12</div></div>`;
    const renderer: FarmMetadataImageRenderer = {
      ...markupRenderer(markup),
      isValidElement: (value) => (value as { constructor?: unknown })?.constructor === undefined,
    };
    const element = Object.assign(Object.create(null), {
      $$typeof: Symbol.for("react.element"),
      type: "div",
      props: {},
    });

    expect(await png(element, renderer)).toEqual(await png(<ReactCard />));
  });

  it("refuses markup without a single root element", async () => {
    const element = { $$markup: true, type: "div", props: null, children: [] };

    await expect(
      createFarmMetadataImageResponse(element, size, {
        renderer: markupRenderer("<!--[--><span>one</span><span>two</span><!--]-->"),
      }),
    ).rejects.toThrow(
      "A metadata image must render one root element, but the app renderer rendered 2 elements at the top level.",
    );
  });
});

describe("resolveFarmMetadataImageValue", () => {
  const props = { params: {}, searchParams: {}, path: "/" };

  it("calls a default-exported function with the route props", async () => {
    const image = async (received: unknown) => ({ received });

    await expect(resolveFarmMetadataImageValue({ default: image }, props)).resolves.toEqual({
      received: props,
    });
  });

  it("renders a renderer's own component as its element instead of calling it", async () => {
    const renderer = markupRenderer("<div></div>");
    const Component = function SvelteComponent() {
      throw new Error("Farm called the component like a plain function.");
    };

    await expect(
      resolveFarmMetadataImageValue({ default: Component }, props, { renderer, component: true }),
    ).resolves.toEqual({ $$markup: true, type: Component, props, children: [] });
  });
});
