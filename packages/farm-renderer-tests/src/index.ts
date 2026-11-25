import { describe, expect, it } from "vitest";

export interface RendererDescriptorFixture {
  name: string;
  vite: string;
  server: string;
  client: string;
  jsxImportSource?: string;
  componentExtensions?: readonly string[];
  dedupe?: readonly string[];
  optimizeDeps?: readonly string[];
  buildConcurrency?: "parallel" | "serial";
  capabilities?: {
    streaming?: {
      node?: boolean;
      web?: boolean;
    };
    reconcilesRerenders?: boolean;
    functionComponents?: boolean;
    hydrationFallback?: boolean;
    islands?: boolean;
  };
}

/**
 * What a renderer's `renderToPipeableStream()` writes to: a Node writable stream in practice. Kept
 * structural so the published types don't require `@types/node`.
 */
export interface RendererPipeDestination {
  write(chunk: unknown): unknown;
  end(): unknown;
}

export interface RendererServerFixture {
  name: string;
  Fragment: unknown;
  Suspense: unknown;
  createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown;
  isValidElement(value: unknown): boolean;
  markFunctionComponent?<T>(component: T): T;
  /** Optional. Farm no longer reads it; one a renderer still exports lets a throw fail the render. */
  ErrorBoundary?: unknown;
  renderToString(element: unknown): string | Promise<string>;
  renderToStringWithHead?(
    element: unknown,
  ): { html: string; head: string } | Promise<{ html: string; head: string }>;
  generateHydrationScript?: () => string;
  renderToPipeableStream?(
    element: unknown,
    callbacks: {
      onShellReady(): void;
      onShellError(error: unknown): void;
      onError(error: unknown): void;
    },
  ): { pipe(destination: RendererPipeDestination): void };
  renderToReadableStream?(
    element: unknown,
  ): ReadableStream<Uint8Array> | Promise<ReadableStream<Uint8Array>>;
}

export interface RendererRootFixture {
  render(element: unknown): void;
  unmount(): void;
}

export interface RendererClientFixture {
  createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown;
  Suspense: unknown;
  createRoot(container: Element): RendererRootFixture;
  hydrateRoot(container: Element, element: unknown): RendererRootFixture;
}

async function settleClientRender(assertion: () => void): Promise<void> {
  let error: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      assertion();
      return;
    } catch (caught) {
      error = caught;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw error;
}

export function defineRendererDescriptorConformance(options: {
  name: string;
  createDescriptor(): RendererDescriptorFixture;
  expected: Partial<RendererDescriptorFixture>;
}): void {
  describe(`${options.name} descriptor conformance`, () => {
    it("returns complete isolated descriptors", () => {
      const first = options.createDescriptor();
      const second = options.createDescriptor();

      expect(first).toMatchObject({ name: options.name, ...options.expected });
      expect(first.vite).toBeTruthy();
      expect(first.server).toBeTruthy();
      expect(first.client).toBeTruthy();
      if (first.componentExtensions) {
        expect(first.componentExtensions).not.toBe(second.componentExtensions);
      }
      if (first.dedupe) expect(first.dedupe).not.toBe(second.dedupe);
      if (first.optimizeDeps) expect(first.optimizeDeps).not.toBe(second.optimizeDeps);
    });
  });
}

export function defineRendererServerConformance(runtime: RendererServerFixture): void {
  describe(`${runtime.name} server conformance`, () => {
    it("exposes FARMJS element primitives", () => {
      expect(runtime.Fragment).toBeTruthy();
      expect(runtime.Suspense).toBeTruthy();
      expect(runtime.isValidElement(runtime.createElement("div", null, "valid"))).toBe(true);
      expect(runtime.isValidElement(null)).toBe(false);
    });

    it("renders nested elements, attributes, and escaped text", async () => {
      const html = await runtime.renderToString(
        runtime.createElement(
          "main",
          { "data-farm-renderer": runtime.name },
          runtime.createElement("h1", null, `Hello from ${runtime.name}`),
          runtime.createElement("p", null, "<unsafe>& content"),
        ),
      );

      expect(html).toContain(`data-farm-renderer="${runtime.name}"`);
      expect(html).toContain(`Hello from ${runtime.name}`);
      expect(html).toContain("&lt;unsafe");
      expect(html).toContain("&amp; content");
      expect(html).not.toContain("<unsafe>");
      expect(html.indexOf("<h1")).toBeLessThan(html.indexOf("<p"));
    });

    it("lets a throw inside the server ErrorBoundary fail the render", async () => {
      if (!runtime.ErrorBoundary) return;
      // The server renderer cannot render a boundary again after a throw, so the boundary passes
      // its children through and Farm answers with the route's error page and status, and a
      // redirect() or notFound() still reaches it, as in production.
      const thrown = Object.assign(new Error("boundary throw"), { digest: "FARM_NOT_FOUND" });
      const Throws = () => {
        throw thrown;
      };
      const Fallback = () => runtime.createElement("p", null, "fallback rendered");
      const element = runtime.createElement(
        runtime.ErrorBoundary,
        { Fallback, fallbackProps: {} },
        runtime.createElement(runtime.markFunctionComponent?.(Throws) ?? Throws, null),
      );

      let rendered: string | undefined;
      let caught: unknown;
      try {
        rendered = await runtime.renderToString(element);
      } catch (error) {
        caught = error;
      }
      expect(rendered).toBeUndefined();
      expect(caught).toBe(thrown);
    });

    it("renders plain function components through the compatibility layer", async () => {
      const FunctionComponent = (props: Record<string, unknown>) =>
        runtime.createElement("section", { "data-label": props.label }, props.children);
      const Component = runtime.markFunctionComponent?.(FunctionComponent) ?? FunctionComponent;
      const html = await runtime.renderToString(
        runtime.createElement(
          Component,
          { label: "function-component" },
          runtime.createElement("span", null, "compat child"),
        ),
      );

      expect(html).toContain('data-label="function-component"');
      expect(html).toContain("<span");
      expect(html).toContain("compat child");
      expect(html).toContain("</span>");
      expect(html).not.toContain("[object Object]");
    });

    it("rejects unsupported async function components instead of rendering garbage", async () => {
      const AsyncFunctionComponent = async () =>
        runtime.createElement("p", null, "async component");
      const Component =
        runtime.markFunctionComponent?.(AsyncFunctionComponent) ?? AsyncFunctionComponent;

      await expect(
        Promise.resolve().then(() =>
          runtime.renderToString(runtime.createElement(Component, null)),
        ),
      ).rejects.toThrow(/async|promise|suspend/i);
    });

    it("returns a deterministic hydration bootstrap", () => {
      const first = runtime.generateHydrationScript?.() ?? "";
      const second = runtime.generateHydrationScript?.() ?? "";
      expect(typeof first).toBe("string");
      expect(second).toBe(first);
    });

    it("keeps renderToStringWithHead consistent with renderToString", async () => {
      if (!runtime.renderToStringWithHead) return;

      const element = runtime.createElement("p", null, `Head-capable ${runtime.name}`);
      const rendered = await runtime.renderToStringWithHead(element);

      expect(rendered.html).toBe(await runtime.renderToString(element));
      expect(typeof rendered.head).toBe("string");
    });

    it("serializes React numeric style values with px units", async () => {
      const html = await runtime.renderToString(
        runtime.createElement("div", {
          style: { marginTop: 4, width: 100, opacity: 0.5, zIndex: 3 },
        }),
      );

      expect(html).toMatch(/margin-top:\s*4px/);
      expect(html).toMatch(/width:\s*100px/);
      expect(html).toMatch(/opacity:\s*0?\.5/);
      expect(html).toMatch(/z-index:\s*3(?!px)/);
    });

    it("does not leak React-only props and maps defaultValue like React", async () => {
      // key and ref are React reconciliation metadata, never DOM attributes.
      const withMetadata = await runtime.renderToString(
        runtime.createElement("div", {
          key: "row-1",
          ref: { current: null },
          id: "kept",
        }),
      );
      expect(withMetadata).toContain('id="kept"');
      expect(withMetadata.toLowerCase()).not.toContain("row-1");
      expect(withMetadata.toLowerCase()).not.toContain(">ref<");
      expect(withMetadata.toLowerCase()).not.toMatch(/\sref=/);
      expect(withMetadata.toLowerCase()).not.toMatch(/\skey=/);

      // React seeds an uncontrolled input by rendering defaultValue as value.
      const withDefaultValue = await runtime.renderToString(
        runtime.createElement("input", { defaultValue: "seed" }),
      );
      expect(withDefaultValue).toContain('value="seed"');
      expect(withDefaultValue.toLowerCase()).not.toContain("defaultvalue");
    });

    it("skips boolean, null, and undefined children like React", async () => {
      // A single boolean child is the `cond && <X/>` idiom. React drops
      // `false`/`true`/`null`/`undefined`; a shim that passes a raw scalar
      // boolean through to the renderer coerces it to visible "false"/"true"
      // text. `0` is not in React's ignore set and must still render.
      const falseChild = await runtime.renderToString(runtime.createElement("div", null, false));
      expect(falseChild).not.toContain("false");

      const trueChild = await runtime.renderToString(runtime.createElement("div", null, true));
      expect(trueChild).not.toContain("true");

      // The `cond && <X/>` idiom: a falsy condition collapses to a bare boolean
      // child that must be skipped, not rendered as "false" text.
      const condition = false;
      const conditional = await runtime.renderToString(
        runtime.createElement(
          "div",
          null,
          condition && runtime.createElement("span", null, "never"),
        ),
      );
      expect(conditional).not.toContain("false");
      expect(conditional).not.toContain("<span");
      expect(conditional).not.toContain("never");

      const nullChild = await runtime.renderToString(runtime.createElement("div", null, null));
      expect(nullChild).not.toContain("null");

      const undefinedChild = await runtime.renderToString(
        runtime.createElement("div", null, undefined),
      );
      expect(undefinedChild).not.toContain("undefined");

      // Mixed children keep their real content and drop the ignored values.
      const mixed = await runtime.renderToString(
        runtime.createElement("div", null, false, "kept", true, null, undefined),
      );
      expect(mixed).toContain("kept");
      expect(mixed).not.toContain("false");
      expect(mixed).not.toContain("true");
      expect(mixed).not.toContain("null");
      expect(mixed).not.toContain("undefined");

      // `0` is falsy but not ignored by React; it must still render as text.
      const zero = await runtime.renderToString(runtime.createElement("div", null, 0));
      expect(zero).toContain("0");
    });

    // Farm answers a shell error with the route's error.tsx and a 500 (or with
    // redirect()/notFound()), which it can only do before the shell is sent.
    const Throwing = () => {
      throw new Error(`${runtime.name} shell failed`);
    };
    const throwingShell = () =>
      runtime.createElement(
        "main",
        null,
        runtime.createElement(runtime.markFunctionComponent?.(Throwing) ?? Throwing, null),
      );

    it("reports a component that throws in the shell as a shell error", async () => {
      const renderToPipeableStream = runtime.renderToPipeableStream;
      if (!renderToPipeableStream) return;

      // Farm calls the renderer where a synchronous throw rejects the render
      // too, so either form reaches the error page.
      const outcome = await new Promise<string>((resolve) => {
        const shellError = (error: unknown) => resolve(`shell error: ${(error as Error).message}`);
        try {
          renderToPipeableStream(throwingShell(), {
            onShellReady: () => resolve("shell ready"),
            onShellError: shellError,
            onError() {},
          });
        } catch (error) {
          shellError(error);
        }
      });

      expect(outcome).toBe(`shell error: ${runtime.name} shell failed`);
    });

    it("errors the readable stream when a component throws in the shell", async () => {
      const renderToReadableStream = runtime.renderToReadableStream;
      if (!renderToReadableStream) return;

      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        await expect(
          Promise.resolve()
            .then(() => renderToReadableStream(throwingShell()))
            .then((stream) => new Response(stream).text()),
        ).rejects.toThrow(`${runtime.name} shell failed`);
        // Unhandled rejections are reported after a macrotask turn.
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }

      expect(unhandled).toEqual([]);
    });
  });
}

export function defineRendererClientConformance(options: {
  name: string;
  client: RendererClientFixture;
  server: Pick<RendererServerFixture, "createElement" | "renderToString">;
  hydrationHtml?: () => string | Promise<string>;
  beforeHydrate?: () => void | Promise<void>;
  /**
   * Whether re-rendering an existing root diffs against the live DOM, matching
   * the renderer descriptor's `capabilities.reconcilesRerenders`. Passing it
   * here keeps the declared capability honest: the renderer is held to the
   * behavior it advertises rather than to an assumption.
   */
  reconcilesRerenders: boolean;
}): void {
  describe(`${options.name} client conformance`, () => {
    it("exports by name what Farm's client entries import", () => {
      // The generated entries import these by name; a renderer needs no default export.
      expect(typeof options.client.createElement).toBe("function");
      expect(options.client.Suspense).toBeTruthy();
      expect(typeof options.client.createRoot).toBe("function");
      expect(typeof options.client.hydrateRoot).toBe("function");
    });

    it(
      options.reconcilesRerenders
        ? "keeps matching DOM and its state when an existing root re-renders"
        : "rebuilds the tree when an existing root re-renders",
      async () => {
        const container = document.createElement("div");
        document.body.append(container);
        const root = options.client.createRoot(container);

        const tree = (label: string) =>
          options.client.createElement(
            "div",
            null,
            options.client.createElement("input", { "data-keep": "1" }),
            options.client.createElement("span", null, label),
          );

        root.render(tree("first"));
        await settleClientRender(() => expect(container.textContent).toBe("first"));

        const before = container.querySelector("input");
        expect(before).toBeTruthy();
        before!.value = "typed-by-user";

        root.render(tree("second"));
        await settleClientRender(() => expect(container.textContent).toBe("second"));
        const after = container.querySelector("input");
        expect(after).toBeTruthy();

        if (options.reconcilesRerenders) {
          // A virtual-DOM renderer matches the incoming tree against what is
          // mounted, so the shared layout a navigation re-renders keeps its
          // DOM identity and anything the user typed into it.
          expect(after).toBe(before);
          expect(after!.value).toBe("typed-by-user");
        } else {
          // A compile-time fine-grained renderer has no virtual DOM to diff,
          // so a freshly materialized tree replaces the nodes. Pinning that
          // here records the real behavior instead of leaving callers to
          // assume reconciliation they will not get.
          expect(after).not.toBe(before);
          expect(after!.value).toBe("");
        }

        root.unmount();
        container.remove();
      },
    );

    it("mounts, updates, wires events, and unmounts a managed root", async () => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = options.client.createRoot(container);
      let clicks = 0;

      root.render(
        options.client.createElement("button", { onClick: () => clicks++ }, "First render"),
      );
      await settleClientRender(() => expect(container.textContent).toBe("First render"));
      container.querySelector("button")?.click();
      expect(clicks).toBe(1);

      root.render(options.client.createElement("p", null, "Second render"));
      await settleClientRender(() => expect(container.textContent).toBe("Second render"));

      root.unmount();
      await settleClientRender(() => expect(container.childNodes).toHaveLength(0));
      container.remove();
    });

    it("replaces what is already in the container on a new root's first render", async () => {
      // Farm creates a root over the server's markup when hydrateRoot() throws, and over the last
      // page when a navigation replaces the root. Neither should stay next to the new render.
      const container = document.createElement("div");
      container.innerHTML = "<p>Server markup</p>";
      document.body.append(container);
      const root = options.client.createRoot(container);

      root.render(options.client.createElement("span", null, "Client render"));
      await settleClientRender(() => expect(container.textContent).toBe("Client render"));
      expect(container.querySelector("p")).toBeNull();

      root.unmount();
      container.remove();
    });

    it("applies numeric styles with px and wires onDoubleClick to dblclick", async () => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = options.client.createRoot(container);
      let doubleClicks = 0;

      root.render(
        options.client.createElement(
          "button",
          {
            style: { width: 100, opacity: 0.5 },
            onDoubleClick: () => doubleClicks++,
          },
          "Double-click me",
        ),
      );
      await settleClientRender(() => {
        const button = container.querySelector("button");
        expect(button).toBeTruthy();
        expect(button!.style.width).toBe("100px");
        expect(button!.style.opacity).toBe("0.5");
      });

      container
        .querySelector("button")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      expect(doubleClicks).toBe(1);

      root.unmount();
      container.remove();
    });

    it("hydrates server markup without replacing its first element", async () => {
      let clicks = 0;
      const props = { onClick: () => clicks++ };
      const element = options.server.createElement("button", props, "Hydrated content");
      const container = document.createElement("div");
      container.innerHTML = options.hydrationHtml
        ? await options.hydrationHtml()
        : await options.server.renderToString(element);
      document.body.append(container);
      const serverNode = container.firstElementChild;

      await options.beforeHydrate?.();
      const root = options.client.hydrateRoot(
        container,
        options.client.createElement("button", props, "Hydrated content"),
      );
      await settleClientRender(() => {
        expect(container.textContent).toContain("Hydrated content");
        container.querySelector("button")?.click();
        expect(clicks).toBeGreaterThan(0);
      });
      expect(container.firstElementChild).toBe(serverNode);

      root.unmount();
      await settleClientRender(() => expect(container.childNodes).toHaveLength(0));
      container.remove();
    });
  });
}

export type RendererServerQueryFixture = (input: undefined) => Promise<{ email: string }>;

/**
 * Server rendering must not read or fill the browser query cache: that cache
 * is one module-level store, so on the server it is shared by every request.
 * `renderQuery` server renders a component that reads `query` through the
 * renderer's server query binding and prints `account=<email>` or
 * `account=loading`.
 */
export function defineRendererServerQueryConformance(options: {
  name: string;
  renderQuery(query: RendererServerQueryFixture): string | Promise<string>;
}): void {
  describe(`${options.name} server query conformance`, () => {
    it("never shows one visitor's query result to the next server render", async () => {
      let visitor = "alice";
      const reads: Promise<unknown>[] = [];
      const query: RendererServerQueryFixture = () => {
        const read = Promise.resolve({ email: `${visitor}@example.com` });
        reads.push(read);
        return read;
      };
      // Let any read a render started finish and land in a cache before the
      // next visitor renders.
      const settleReads = async () => {
        await Promise.all(reads);
        await new Promise((resolve) => setTimeout(resolve, 0));
      };

      const alice = await options.renderQuery(query);
      await settleReads();
      visitor = "bob";
      const bob = await options.renderQuery(query);
      await settleReads();

      expect(bob).not.toContain("alice@example.com");
      // Like React's server snapshot, the browser fetch starts after hydration.
      expect(reads).toHaveLength(0);
      expect(alice).toContain("account=loading");
      expect(bob).toContain("account=loading");
    });
  });
}

/** What `createFarmNativeTreeResponse` answers: the parts of the tree this conformance reads. */
export interface RendererNativeTreeNode {
  type: string;
  tag?: string;
  href?: string;
  name?: string;
  form?: { action: string; method: string; fields?: Array<{ name: string; value: string }> };
  submit?: Record<string, unknown>;
  children?: Array<RendererNativeTreeNode | string>;
}

/**
 * The native tier draws a page from the HTML the server renders, so it must read every renderer's
 * markup the same way: its comment markers, hydration keys, and fragment boundaries included.
 * `toTree` turns a page's HTML into the native tree, as a mobile app's server would answer it.
 */
export function defineRendererNativeTreeConformance(
  runtime: RendererServerFixture,
  toTree: (html: string) => Promise<{ unsupported: string[]; root: RendererNativeTreeNode }>,
): void {
  describe(`${runtime.name} native tree conformance`, () => {
    it("draws a static page, a list, a link, and a form the same as any renderer", async () => {
      const h = runtime.createElement;
      const Trail = (props: Record<string, unknown>) =>
        h("li", null, h("a", { href: `/trails/${String(props.id)}` }, props.name as string));
      runtime.markFunctionComponent?.(Trail);
      const trails = [
        { id: "creek", name: "Creek Loop" },
        { id: "ridge", name: "Ridge Traverse" },
      ];
      const html = await runtime.renderToString(
        h(
          "main",
          null,
          h("h1", null, "Trails"),
          // Adjacent text and values: renderers separate them with comment markers.
          h("p", null, "Hello ", "Ada", "!"),
          false,
          null,
          h(
            "ul",
            null,
            trails.map((trail) => h(Trail, { key: trail.id, id: trail.id, name: trail.name })),
          ),
          h(
            "form",
            { method: "post", action: "/api/reports" },
            h("input", { type: "hidden", name: "trail", value: "creek" }),
            h("textarea", { name: "text" }),
            h("button", null, "Post"),
          ),
        ),
      );
      const tree = await toTree(html);
      expect(tree.unsupported).toEqual([]);
      const text = (node: RendererNativeTreeNode | string): string =>
        typeof node === "string" ? node : (node.children ?? []).map(text).join("");
      const find = (
        node: RendererNativeTreeNode | string,
        test: (node: RendererNativeTreeNode) => boolean,
      ): RendererNativeTreeNode[] =>
        typeof node === "string"
          ? []
          : [
              ...(test(node) ? [node] : []),
              ...(node.children ?? []).flatMap((child) => find(child, test)),
            ];
      expect(find(tree.root, (node) => node.tag === "h1").map(text)).toEqual(["Trails"]);
      expect(find(tree.root, (node) => node.tag === "p").map(text)).toEqual(["Hello Ada!"]);
      expect(
        find(tree.root, (node) => node.href !== undefined).map((link) => [link.href, text(link)]),
      ).toEqual([
        ["https://app.example/trails/creek", "Creek Loop"],
        ["https://app.example/trails/ridge", "Ridge Traverse"],
      ]);
      const [form] = find(tree.root, (node) => node.form !== undefined);
      expect(form?.form).toEqual({
        action: "https://app.example/api/reports",
        method: "post",
        fields: [{ name: "trail", value: "creek" }],
      });
      expect(find(form!, (node) => node.type === "TextInput").map((field) => field.name)).toEqual([
        "text",
      ]);
      expect(find(form!, (node) => node.submit !== undefined).map(text)).toEqual(["Post"]);
    });
  });
}

export type RendererIslandStrategy = "load" | "idle" | "visible" | "interaction";

/** What Farm passes `withIsland()` for each export of a `"use client"` module. */
export interface RendererIslandReference {
  src: string;
  export: string;
  strategy: RendererIslandStrategy;
}

export interface RendererIslandsServerFixture {
  createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown;
  markFunctionComponent?<T>(component: T): T;
  renderToString(element: unknown): string | Promise<string>;
  withIsland(component: unknown, reference: RendererIslandReference): unknown;
  wrapClientGraph?(element: unknown): unknown;
  isolateServerPageGraph?(element: unknown): unknown;
}

/** The attributes of the first `<f-island>` in `html`, and the markup inside it. */
function readIsland(html: string): { attributes: string; inner: string } | undefined {
  const match = /<f-island\b([^>]*)>([\s\S]*?)<\/f-island>/.exec(html);
  return match ? { attributes: match[1]!, inner: match[2]! } : undefined;
}

/**
 * Islands (`capabilities.islands`): the server module's `withIsland()` writes the island Farm's
 * runtime starts, and `wrapClientGraph()` and `isolateServerPageGraph()`, when exported, turn
 * islands off and on again around a tree that hydrates as one root.
 */
export function defineRendererIslandsConformance(options: {
  name: string;
  server: RendererIslandsServerFixture;
}): void {
  const { server } = options;
  const reference: RendererIslandReference = {
    src: "/src/components/counter.tsx",
    export: "Counter",
    strategy: "idle",
  };
  const Counter = (props: Record<string, unknown>) =>
    server.createElement("button", null, `${String(props.label)}: 0`);
  const component = server.markFunctionComponent?.(Counter) ?? Counter;
  const plain = () => server.renderToString(server.createElement(component, { label: "Plant" }));

  describe(`${options.name} islands conformance`, () => {
    it("writes a client component as an island with its src, export, and strategy", async () => {
      const Island = server.withIsland(component, reference);
      const html = await server.renderToString(
        server.createElement(Island, { label: "Plant", "client:visible": true }),
      );
      const island = readIsland(html);

      expect(island, `no <f-island> in ${html}`).toBeDefined();
      expect(island!.attributes).toContain(`src="${reference.src}"`);
      expect(island!.attributes).toContain(`export="${reference.export}"`);
      expect(island!.attributes).toContain('strategy="visible"');
      // The style is a CSS string: a renderer that takes style objects still writes it.
      expect(island!.attributes).toContain('style="display:contents"');
      expect(island!.inner).toBe(await plain());
      // The props go to the browser in the script right after the island, which names it by its
      // props attribute. The script's text is written raw, and client:* never reaches it.
      const id = /\bprops="([^"]+)"/.exec(island!.attributes)?.[1];
      expect(id, `no props attribute on the island in ${html}`).toBeDefined();
      const after = html.slice(html.indexOf("</f-island>") + "</f-island>".length);
      expect(after).toMatch(new RegExp(`^<script\\b[^>]*\\bfor="${id}"[^>]*>`));
      expect(after).toContain('"label":"Plant"');
      expect(html).not.toContain("client:visible");
    });

    it("uses the module's strategy when no client:* attribute sets one", async () => {
      const Island = server.withIsland(component, reference);
      const html = await server.renderToString(server.createElement(Island, { label: "Plant" }));

      expect(readIsland(html)?.attributes).toContain('strategy="idle"');
    });

    it("keeps the server HTML without an island when a prop can't reach the browser", async () => {
      const Island = server.withIsland(component, reference);
      // Farm logs the prop once; keep that out of the test output.
      const warn = console.warn;
      console.warn = () => {};
      try {
        const html = await server.renderToString(
          server.createElement(Island, { label: "Plant", onHarvest: () => {} }),
        );
        expect(html).toBe(await plain());
      } finally {
        console.warn = warn;
      }
    });

    it("returns an export that isn't a component as it is", () => {
      expect(server.withIsland("idle", reference)).toBe("idle");
    });

    it.skipIf(typeof server.wrapClientGraph !== "function")(
      "renders a client component plain inside a tree that hydrates as one root",
      async () => {
        const Island = server.withIsland(component, reference);
        const html = await server.renderToString(
          server.wrapClientGraph!(
            server.createElement(Island, { label: "Plant", "client:load": true }),
          ),
        );
        expect(html).toBe(await plain());
      },
    );

    it.skipIf(
      typeof server.wrapClientGraph !== "function" ||
        typeof server.isolateServerPageGraph !== "function",
    )("starts islands again in a server page that root keeps as HTML", async () => {
      const Island = server.withIsland(component, reference);
      const html = await server.renderToString(
        server.wrapClientGraph!(
          server.createElement(
            "main",
            null,
            server.isolateServerPageGraph!(server.createElement(Island, { label: "Plant" })),
          ),
        ),
      );
      expect(readIsland(html)?.inner).toBe(await plain());
    });
  });
}

export type RendererRouteKind = "page" | "layout" | "loading" | "error" | "not-found";

/** A route `routes().resolve()` returns. */
export interface RendererRouteFixture {
  kind: RendererRouteKind;
  pattern: string;
  hydrate?: boolean;
  strategy?: RendererIslandStrategy;
}

/** A page or layout's settings, as `hydration.resolve()` returns them. */
export interface RendererHydrationFixture {
  hydrate?: boolean;
  strategy?: RendererIslandStrategy;
}

/** What Farm passes `routes().resolve()`. */
export interface RendererRouteFileFixture {
  path: string;
  segments: readonly string[];
  name: string;
  extension: string;
}

export interface RendererRoutesFixture {
  dir?: string;
  resolve(file: RendererRouteFileFixture): unknown;
}

export interface RendererSourceDescriptorFixture {
  routes?(context: {
    root: string;
    defaults: RendererRoutesFixture;
  }): RendererRoutesFixture | Promise<RendererRoutesFixture>;
  hydration?: { resolve?(source: string, file: string): unknown };
  compile?(source: string, file: string): unknown;
}

/** A file in your renderer's format, and what each hook should say about it. */
export interface RendererSourceFile {
  /**
   * Relative to the project root, with `/` separators: `"src/app/blog/[slug].leaf"`. A file with a
   * `route` is inside the directory `routes()` scans.
   */
  path: string;
  /** The file's source. Needed for `hydration` and `client`. */
  source?: string;
  /** What `routes().resolve()` returns: a route, or `null` for a file that isn't one. */
  route?: RendererRouteFixture | null;
  /** What `hydration.resolve()` returns, or `null` to leave the file to Farm's exports. */
  hydration?: RendererHydrationFixture | null;
  /** Whether the module `compile()` returns has `"use client"` in its directive prologue. */
  client?: boolean;
}

const ROUTE_KINDS: ReadonlySet<string> = new Set([
  "page",
  "layout",
  "loading",
  "error",
  "not-found",
]);
const ISLAND_STRATEGIES: ReadonlySet<string> = new Set(["load", "idle", "visible", "interaction"]);

/**
 * Farm's folder rules, as `routes()` gets them in `defaults`: a file named `page`, `layout`,
 * `loading` or `error` is that route for its directory, and a `not-found` file directly in it is
 * the not-found page.
 */
const folderRoutes: RendererRoutesFixture = {
  dir: "src/app",
  resolve(file) {
    if (!ROUTE_KINDS.has(file.name)) return null;
    if (file.name === "not-found" && file.segments.length > 0) return null;
    return { kind: file.name, pattern: `/${file.segments.join("/")}` };
  },
};

function routeFile(path: string): RendererRouteFileFixture {
  const parts = path.split("/");
  const fileName = parts.pop()!;
  const dot = fileName.lastIndexOf(".");
  const extension = dot > 0 ? fileName.slice(dot).toLowerCase() : "";
  return Object.freeze({
    path,
    segments: Object.freeze(parts),
    name: dot > 0 ? fileName.slice(0, dot) : fileName,
    extension,
  });
}

/**
 * Whether `code` starts with a `"use client"` directive: one of the string-literal statements
 * before any other code, with comments and other directives such as `"use strict"` allowed
 * around it. Farm reads a module this way when it plans what hydrates.
 */
function hasUseClientDirective(code: string): boolean {
  const prologue = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|(["'])((?:(?!\1)[^\\\n]|\\.)*)\1\s*;?)/;
  let rest = code;
  for (let match = prologue.exec(rest); match && match[0]; match = prologue.exec(rest)) {
    if (match[1] && match[2] === "use client") return true;
    rest = rest.slice(match[0].length);
  }
  return false;
}

function expectRendererHydration(value: unknown, where: string): void {
  if (value === null || value === undefined) return;
  expect(typeof value, `${where} returned ${JSON.stringify(value)}`).toBe("object");
  const { hydrate, strategy } = value as Record<string, unknown>;
  if (hydrate !== undefined) expect(typeof hydrate, `${where}: hydrate`).toBe("boolean");
  if (strategy !== undefined) {
    expect(ISLAND_STRATEGIES.has(String(strategy)), `${where}: strategy ${String(strategy)}`).toBe(
      true,
    );
  }
}

/**
 * The build-time hooks that read your own file format, run against files you list: `routes()`
 * maps each to a route Farm can serve, `hydration.resolve()` reads its settings, and `compile()`
 * returns a module whose `"use client"` Farm can find. A hook your descriptor doesn't have, or a
 * field a file leaves out, is skipped. Each hook must give the same answer for the same file.
 */
export function defineRendererSourceConformance(options: {
  name: string;
  createDescriptor(): RendererSourceDescriptorFixture;
  /** The project root: `routes()` gets it, and the other hooks get each file's path under it. */
  root?: string;
  files: readonly RendererSourceFile[];
}): void {
  const root = (options.root ?? "/project").replace(/\/+$/, "");

  describe(`${options.name} source conformance`, () => {
    const descriptor = options.createDescriptor();
    const routed = options.files.filter((file) => file.route !== undefined);
    const hydrated = options.files.filter((file) => file.hydration !== undefined);
    const compiled = options.files.filter((file) => file.client !== undefined);

    const loadRoutes = async () => {
      const routes = await descriptor.routes!({ root, defaults: folderRoutes });
      expect(routes, "routes() returned no rules").toBeTruthy();
      expect(typeof routes.resolve, "routes() returned no resolve(file)").toBe("function");
      if (routes.dir !== undefined) {
        expect(typeof routes.dir, "routes(): dir").toBe("string");
        expect(/^(?:\/|\.\.(?:\/|$))/.test(routes.dir), `routes(): dir ${routes.dir}`).toBe(false);
      }
      return routes;
    };

    describe.skipIf(typeof descriptor.routes !== "function" || routed.length === 0)(
      "routes()",
      () => {
        it.each(routed)("maps $path", async (file) => {
          const routes = await loadRoutes();
          const dir = `${(routes.dir ?? "src/app").replace(/^\.\/|\/+$/g, "")}/`;
          expect(
            file.path.startsWith(dir),
            `${file.path} isn't in ${dir}, which routes() scans`,
          ).toBe(true);
          const relative = file.path.slice(dir.length);
          const first = routes.resolve.call(routes, routeFile(relative)) ?? null;
          const second = routes.resolve.call(routes, routeFile(relative)) ?? null;

          expect(second, "a second call returned something else").toEqual(first);
          expect(first).toEqual(file.route);
          if (first === null) return;
          const route = first as Record<string, unknown>;
          expect(ROUTE_KINDS.has(String(route.kind)), `kind ${String(route.kind)}`).toBe(true);
          expect(String(route.pattern)).toMatch(/^\//);
          // Each segment is a folder name Farm can route: no empty, dot, or @slot segments.
          const pattern = String(route.pattern);
          for (const segment of pattern === "/" ? [] : pattern.slice(1).split("/")) {
            expect(
              segment !== "" && segment !== "." && segment !== ".." && !/^@|[\\?#]/.test(segment),
              `segment ${JSON.stringify(segment)} of ${pattern}`,
            ).toBe(true);
          }
          if (route.kind === "not-found") expect(route.pattern).toBe("/");
          expectRendererHydration(route, `routes() for ${file.path}`);
        });
      },
    );

    describe.skipIf(typeof descriptor.hydration?.resolve !== "function" || hydrated.length === 0)(
      "hydration.resolve()",
      () => {
        it.each(hydrated)("reads $path", async (file) => {
          const path = `${root}/${file.path}`;
          const source = file.source ?? "";
          const first = descriptor.hydration!.resolve!(source, path) ?? null;
          const second = descriptor.hydration!.resolve!(source, path) ?? null;

          expect(second, "a second call returned something else").toEqual(first);
          expect(first).toEqual(file.hydration);
          expectRendererHydration(first, `hydration.resolve() for ${file.path}`);
        });
      },
    );

    describe.skipIf(typeof descriptor.compile !== "function" || compiled.length === 0)(
      "compile()",
      () => {
        it.each(compiled)("compiles $path", async (file) => {
          const path = `${root}/${file.path}`;
          const source = file.source ?? "";
          const first = descriptor.compile!(source, path);
          const second = descriptor.compile!(source, path);

          expect(typeof first, "compile() must return the module's source as a string").toBe(
            "string",
          );
          expect(second, "a second call returned something else").toBe(first);
          expect(
            hasUseClientDirective(first as string),
            file.client
              ? `"use client" isn't in the directive prologue of:\n${first as string}`
              : `"use client" is in the directive prologue of:\n${first as string}`,
          ).toBe(file.client);
        });
      },
    );
  });
}
