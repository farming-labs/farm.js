// @vitest-environment node

import { Writable } from "node:stream";
import {
  defineRendererDescriptorConformance,
  defineRendererServerConformance,
} from "@farm.js/renderer-tests";
import { escape, ssr } from "solid-js/web";
import { describe, expect, it } from "vitest";
import { solid } from "../index";
import * as serverRuntime from "../server";
import {
  createElement,
  generateHydrationScript,
  renderToPipeableStream,
  renderToReadableStream,
  renderToString,
} from "../server";

defineRendererDescriptorConformance({
  name: "solid",
  createDescriptor: solid,
  expected: {
    vite: "@farm.js/solid/vite",
    server: "@farm.js/solid/server",
    client: "@farm.js/solid/client",
    jsxImportSource: "solid-js",
    capabilities: { streaming: { node: true, web: true } },
  },
});

defineRendererServerConformance(serverRuntime);

describe("Solid renderer", () => {
  it("streams FARMJS elements through Solid's Node adapter", async () => {
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

      const stream = renderToPipeableStream(createElement("p", null, "Streamed from Solid"), {
        onShellReady() {
          stream.pipe(destination);
        },
        onShellError: reject,
        onError: reject,
      });
    });

    expect(html).toContain("Streamed from Solid");
  });

  it("streams FARMJS elements through Solid's Web adapter", async () => {
    const stream = renderToReadableStream(createElement("p", null, "Solid Web stream"));

    await expect(new Response(stream).text()).resolves.toContain("Solid Web stream");
  });
  it("provides Solid's hydration bootstrap for server documents", () => {
    expect(generateHydrationScript()).toContain("window._$HY");
  });

  it("renders children passed as a prop, as core wraps layouts and slots", async () => {
    // vite-plugin-solid compiles `<main class="shell"><nav>nav</nav>{props.children}</main>`
    // to this ssr()/escape() shape. Core wraps every layout as
    // createElement(Layout, { children: element }), so the child arrives as a
    // prop rather than positionally.
    function Layout(props: { children?: unknown }) {
      return ssr(
        ['<main class="shell"><nav>nav</nav>', "</main>"] as unknown as TemplateStringsArray,
        escape(props.children) as string,
      );
    }

    const page = createElement("p", null, "page body");
    const html = await renderToString(createElement(Layout, { children: page }));

    expect(html).toContain("page body");
    expect(html).not.toContain("undefined");
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
