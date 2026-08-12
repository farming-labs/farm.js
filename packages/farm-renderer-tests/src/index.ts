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
  capabilities?: {
    streaming?: {
      node?: boolean;
      web?: boolean;
    };
  };
}

export interface RendererServerFixture {
  name: string;
  Fragment: unknown;
  Suspense: unknown;
  createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown;
  isValidElement(value: unknown): boolean;
  renderToString(element: unknown): string | Promise<string>;
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
  });
}

export function defineRendererClientConformance(options: {
  name: string;
  client: RendererClientFixture;
  server: Pick<RendererServerFixture, "createElement" | "renderToString">;
  hydrationHtml?: () => string | Promise<string>;
  beforeHydrate?: () => void | Promise<void>;
}): void {
  describe(`${options.name} client conformance`, () => {
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
