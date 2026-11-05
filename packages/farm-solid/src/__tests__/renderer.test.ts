// @vitest-environment node

import { Writable } from "node:stream";
import {
  defineRendererDescriptorConformance,
  defineRendererServerConformance,
  defineRendererServerQueryConformance,
} from "@farm.js/renderer-tests";
import { Suspense, createResource, createSignal, createUniqueId } from "solid-js";
import { createComponent, escape, ssr, ssrAttribute, ssrHydrationKey } from "solid-js/web";
import { describe, expect, it } from "vitest";
import type { ServerQuery } from "@farm.js/core/server-query";
import { useServerQuery } from "../bindings";
import { solid } from "../index";
import * as serverRuntime from "../server";
import {
  createElement,
  generateHydrationScript,
  renderToPipeableStream,
  renderToReadableStream,
  renderToString,
} from "../server";
import { SERVER_LAYOUT_ISLAND_HTML, UNIQUE_ID_ISLAND_HTML } from "./unique-id-island.fixture";

defineRendererDescriptorConformance({
  name: "solid",
  createDescriptor: solid,
  expected: {
    vite: "@farm.js/solid/vite",
    server: "@farm.js/solid/server",
    client: "@farm.js/solid/client",
    jsxImportSource: "solid-js",
    capabilities: {
      streaming: { node: true, web: true },
      functionComponents: true,
    },
  },
});

defineRendererServerConformance(serverRuntime);

defineRendererServerQueryConformance({
  name: "solid",
  renderQuery(query) {
    const Account = () => {
      const account = useServerQuery(
        query as unknown as ServerQuery<undefined, { email: string }>,
        undefined,
      );
      return ssr(["<p>", "</p>"], escape(`account=${account.data?.email ?? "loading"}`));
    };
    return renderToString(createElement(Account, null));
  },
});

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
  it("puts Farm's CSP nonce on the hydration data scripts it emits", async () => {
    function Data() {
      const [data] = createResource(async () => "value");
      return createComponent(Suspense, {
        get children() {
          return ssr(["<p>", "</p>"] as unknown as TemplateStringsArray, escape(data()) as string);
        },
      });
    }
    const scriptTags = (html: string) => html.match(/<script\b[^>]*>/g) ?? [];

    const html = await renderToString(createElement(Data, null), { nonce: "abc123" });
    expect(scriptTags(html).length).toBeGreaterThan(0);
    expect(scriptTags(html).every((tag) => tag.includes('nonce="abc123"'))).toBe(true);

    const streamed = await new Response(
      renderToReadableStream(createElement(Data, null), { nonce: "abc123" }),
    ).text();
    expect(scriptTags(streamed).length).toBeGreaterThan(0);
    expect(scriptTags(streamed).every((tag) => tag.includes('nonce="abc123"'))).toBe(true);

    const unsecured = await renderToString(createElement(Data, null));
    expect(unsecured).not.toContain("nonce=");
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

  it("writes the island root's render id when the root creates an id before its first element", async () => {
    // vite-plugin-solid compiles the island in client-island.test.tsx to this
    // ssr() shape. createUniqueId() takes the first id in the component's
    // context, so its first element's key no longer ends in "00".
    function UniqueIdIsland() {
      const id = createUniqueId();
      const [count] = createSignal(0);
      return ssr(
        [
          "<button",
          ' type="button"',
          ">count: <!--$-->",
          "<!--/--></button>",
        ] as unknown as TemplateStringsArray,
        ssrHydrationKey(),
        ssrAttribute("id", escape(id, true), false),
        escape(count()),
      );
    }

    const html = await renderToString(
      createElement(
        "div",
        { id: "__farm_page__", "data-farm-island": "page" },
        createElement(UniqueIdIsland),
      ),
    );

    expect(html).toBe(UNIQUE_ID_ISLAND_HTML);
  });

  describe("server-only segments", () => {
    const template = (strings: string[]) => strings as unknown as TemplateStringsArray;

    // A layout Farm never ships to the browser, reading request data the way a
    // server-only layout reads middleware context.
    function AccountLayout(props: { children?: unknown }) {
      const [account] = createResource(async () => ({
        email: "a@example.com",
        token: "LAYOUT-SECRET",
      }));
      return createComponent(Suspense, {
        fallback: "loading",
        get children() {
          return ssr(
            template(["<section", "><p>", "</p>", "</section>"]),
            ssrHydrationKey(),
            escape(account()?.email),
            escape(props.children),
          );
        },
      });
    }

    function CounterPage() {
      const [data] = createResource(async () => ({ label: "PAGE-VALUE" }));
      return createComponent(Suspense, {
        fallback: "loading",
        get children() {
          return ssr(
            template(["<button", ' type="button">', "</button>"]),
            ssrHydrationKey(),
            escape(data()?.label),
          );
        },
      });
    }

    // The tree core builds: layout boundary, layout, then the page boundary.
    function document(page: { client: boolean; layoutClient?: boolean }) {
      return createElement(
        "div",
        { "data-farm-layout-boundary": "true", "data-farm-layout-pattern": "/" },
        createElement(AccountLayout, {
          children: createElement(
            "div",
            {
              id: "__farm_page__",
              "data-farm-segment": "page",
              "data-farm-client": page.client ? "true" : "false",
              ...(page.layoutClient ? { "data-farm-layout-client": "true" } : {}),
              "data-farm-island": "page",
            },
            createElement(CounterPage),
          ),
        }),
      );
    }

    const renderers = {
      string: (element: unknown) => renderToString(element),
      stream: (element: unknown) => new Response(renderToReadableStream(element)).text(),
    };

    it.each(Object.entries(renderers))(
      "keeps a server-only layout's resource out of the %s HTML when only the page hydrates",
      async (_name, render) => {
        const html = await render(document({ client: true }));

        expect(html).toContain("<p>a@example.com</p>");
        expect(html).not.toContain("LAYOUT-SECRET");
        // The hydrating page still serializes its resource and names its root.
        expect(html).toContain('{label:"PAGE-VALUE"}');
        expect(html).toMatch(/<div[^>]* id="__farm_page__"[^>]* data-farm-solid-render-id="\w+">/);
        expect(html).toMatch(/<button data-hk="\w+" type="button">PAGE-VALUE<\/button>/);
      },
    );

    it.each(Object.entries(renderers))(
      "serializes nothing into the %s HTML when neither the page nor a layout hydrates",
      async (_name, render) => {
        const html = await render(document({ client: false }));

        expect(html).toContain("<p>a@example.com</p>");
        expect(html).toMatch(/type="button">PAGE-VALUE<\/button>/);
        expect(html).not.toContain("LAYOUT-SECRET");
        expect(html).not.toContain('PAGE-VALUE"');
      },
    );

    it("keeps serializing a hydrating layout chain, which the browser renders", async () => {
      const html = await renderToString(document({ client: false, layoutClient: true }));

      expect(html).toContain('token:"LAYOUT-SECRET"');
      // Its server-only page stays server HTML inside the hydrated chain.
      expect(html).not.toContain('{label:"PAGE-VALUE"}');
    });

    it("renders a hydrating island inside a server-only layout", async () => {
      function Layout(props: { children?: unknown }) {
        const [account] = createResource(() => ({
          email: "a@example.com",
          token: "LAYOUT-SECRET",
        }));
        return ssr(
          template(["<section", "><p>", "</p>", "</section>"]),
          ssrHydrationKey(),
          escape(account()?.email),
          escape(props.children),
        );
      }
      // Compiled form of the island in client-island.test.tsx (see above).
      function UniqueIdIsland() {
        const id = createUniqueId();
        const [count] = createSignal(0);
        return ssr(
          template(["<button", ' type="button"', ">count: <!--$-->", "<!--/--></button>"]),
          ssrHydrationKey(),
          ssrAttribute("id", escape(id, true), false),
          escape(count()),
        );
      }

      const html = await renderToString(
        createElement(Layout, {
          children: createElement(
            "div",
            {
              id: "__farm_page__",
              "data-farm-segment": "page",
              "data-farm-client": "true",
              "data-farm-island": "page",
            },
            createElement(UniqueIdIsland),
          ),
        }),
      );

      expect(html).toBe(SERVER_LAYOUT_ISLAND_HTML);
    });
  });
});
