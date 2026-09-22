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
  };
}

export interface RendererServerFixture {
  name: string;
  Fragment: unknown;
  Suspense: unknown;
  createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown;
  isValidElement(value: unknown): boolean;
  renderToString(element: unknown): string | Promise<string>;
  renderToStringWithHead?(
    element: unknown,
  ): { html: string; head: string } | Promise<{ html: string; head: string }>;
  generateHydrationScript?: () => string;
}

export interface RendererRootFixture {
  render(element: unknown): void;
  unmount(): void;
}

export interface RendererClientFixture {
  createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown;
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
