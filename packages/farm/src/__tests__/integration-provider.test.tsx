import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  generateFarmIntegrationProviderClientCode,
  generateFarmIntegrationProviderServerModules,
} from "../integration-provider-build";
import { defineIntegration, getIntegrationProviders } from "../integrations";
import { REACT_RENDERER } from "../renderer";
import { ServerRenderer } from "../server/renderer";

describe("integration providers", () => {
  it("carries and renders a configured provider component on the server", async () => {
    function AcmeProvider({ children }: { children: ReactNode }) {
      return createElement("section", { "data-acme-provider": "" }, children);
    }

    const acme = defineIntegration({
      category: "custom",
      type: "acme",
      instance: {},
      providers: [{ name: "acme", type: "client", component: AcmeProvider }],
    });
    const providers = getIntegrationProviders({ acme });
    expect(providers[0]?.component).toBe(AcmeProvider);
    expect(providers[0]?.supportsIsolatedHydration).toBeUndefined();

    const renderer = new ServerRenderer(
      {
        root: process.cwd(),
        outDir: ".farm-integration-provider-test",
        integrations: { acme },
        renderer: REACT_RENDERER,
      } as any,
      {} as any,
    );
    (renderer as any).rendererRuntime = { createElement };
    const wrapped = await (renderer as any).wrapWithIntegrationProviders(
      createElement("span", null, "inside"),
    );

    expect(renderToStaticMarkup(wrapped)).toBe(
      '<section data-acme-provider=""><span>inside</span></section>',
    );
  });

  it("generates statically traceable client imports for provider modules", () => {
    const generated = generateFarmIntegrationProviderClientCode(
      [
        {
          name: "acme",
          type: "client",
          props: { publishableKey: "pk_test" },
          component: { module: "@/components/acme-provider", export: "AcmeProvider" },
        },
      ],
      "/app",
    );

    expect(generated.imports).toContain(
      'import * as FarmIntegrationProviderModule0 from "@/components/acme-provider";',
    );
    expect(generated.runtime).toContain('name: "acme"');
    expect(generated.runtime).toContain('FarmIntegrationProviderModule0["AcmeProvider"]');
    expect(generated.runtime).toContain("React.createElement(provider.Component");
  });

  it("leaves provider components unmarked for a renderer without its own extensions", () => {
    const providers = [
      {
        name: "acme",
        type: "client" as const,
        props: {},
        component: { module: "@/components/acme-provider", export: "AcmeProvider" },
      },
    ];

    // React compiles nothing of its own, so every provider is already a
    // function component and there is nothing to disambiguate.
    const client = generateFarmIntegrationProviderClientCode(providers, "/app");
    const server = generateFarmIntegrationProviderServerModules(providers, "/app");

    expect(client.runtime).not.toContain("farmMarkProviderComponent");
    expect(server.entries).not.toContain("farmMarkProviderComponent");
    expect(server.helpers).toBe("");
  });

  it("marks only non-renderer-compiled provider components", () => {
    const providers = [
      {
        name: "acme",
        type: "client" as const,
        props: {},
        component: { module: "@/components/acme-provider", export: "AcmeProvider" },
      },
      {
        name: "beta",
        type: "client" as const,
        props: {},
        component: { module: "@/components/beta-provider.svelte" },
      },
    ];

    const client = generateFarmIntegrationProviderClientCode(providers, "/app", [".svelte"]);
    const server = generateFarmIntegrationProviderServerModules(providers, "/app", [".svelte"]);

    // The .tsx-style provider is a function component the Svelte adapter must
    // call; the .svelte one is a component Svelte instantiates itself.
    expect(client.runtime).toContain(
      'farmMarkProviderComponent(FarmIntegrationProviderModule0["AcmeProvider"])',
    );
    expect(client.runtime).toContain('FarmIntegrationProviderModule1["default"]');
    expect(client.runtime).not.toContain(
      'farmMarkProviderComponent(FarmIntegrationProviderModule1["default"])',
    );
    expect(client.runtime).toContain("const farmMarkProviderComponent =");

    expect(server.entries).toContain(
      'farmMarkProviderComponent(FarmServerIntegrationProviderModule0["AcmeProvider"])',
    );
    expect(server.entries).not.toContain(
      'farmMarkProviderComponent(FarmServerIntegrationProviderModule1["default"])',
    );
    expect(server.helpers).toContain("const farmMarkProviderComponent =");
  });

  it("treats a renderer component extension case-insensitively", () => {
    const server = generateFarmIntegrationProviderServerModules(
      [
        {
          name: "acme",
          type: "client" as const,
          props: {},
          component: { module: "@/components/Acme.Svelte" },
        },
      ],
      "/app",
      [".svelte"],
    );

    expect(server.entries).not.toContain("farmMarkProviderComponent");
    expect(server.helpers).toBe("");
  });

  it("preserves an explicit isolated-root capability declaration", () => {
    const acme = defineIntegration({
      category: "custom",
      type: "acme",
      instance: {},
      providers: [
        {
          name: "acme",
          type: "client",
          component: { module: "@/components/acme-provider" },
          supportsIsolatedHydration: true,
        },
      ],
    });

    expect(getIntegrationProviders({ acme })[0]?.supportsIsolatedHydration).toBe(true);
  });

  it("resolves provider paths relative to the app root", () => {
    const generated = generateFarmIntegrationProviderClientCode(
      [
        {
          name: "acme",
          type: "client",
          component: { module: "./src/components/acme-provider" },
        },
      ],
      "/app",
    );

    expect(generated.imports).toContain(
      'import * as FarmIntegrationProviderModule0 from "/src/components/acme-provider";',
    );
  });

  it("resolves relative provider modules from the app root in development", async () => {
    function AcmeProvider({ children }: { children: ReactNode }) {
      return createElement("section", { "data-acme-provider": "" }, children);
    }
    const ssrLoadModule = vi.fn(async () => ({ default: AcmeProvider }));
    const acme = defineIntegration({
      category: "custom",
      type: "acme",
      instance: {},
      providers: [
        {
          name: "acme",
          type: "client",
          component: { module: "./src/components/acme-provider" },
        },
      ],
    });
    const renderer = new ServerRenderer(
      {
        root: "/app",
        outDir: ".farm-integration-provider-test",
        integrations: { acme },
        renderer: REACT_RENDERER,
      } as any,
      {} as any,
    );
    (renderer as any).viteServer = { ssrLoadModule };
    (renderer as any).rendererRuntime = { createElement };

    const wrapped = await (renderer as any).wrapWithIntegrationProviders(
      createElement("span", null, "inside"),
    );

    expect(ssrLoadModule).toHaveBeenCalledWith("/src/components/acme-provider");
    expect(renderToStaticMarkup(wrapped)).toContain("data-acme-provider");
  });

  it("does not import Clerk when a Clerk provider configures its own component", () => {
    const providers = [
      {
        name: "custom-clerk",
        type: "clerk",
        component: { module: "@/components/custom-clerk-provider" },
      },
    ];
    const client = generateFarmIntegrationProviderClientCode(providers, "/app");
    const server = generateFarmIntegrationProviderServerModules(providers, "/app");

    expect(client.imports).not.toContain("@clerk/react");
    expect(server.hasClerkProvider).toBe(false);
    expect(server.imports).not.toContain("@clerk/react");
  });

  it("rejects opaque function components from client generation", () => {
    expect(() =>
      generateFarmIntegrationProviderClientCode(
        [
          {
            name: "acme",
            type: "client",
            component: ({ children }) => children,
          },
        ],
        "/app",
      ),
    ).toThrow(/importable component reference/);
  });

  it("ignores integration metadata providers without renderable components", () => {
    const generated = generateFarmIntegrationProviderClientCode(
      [{ name: "metadata", type: "client", props: { mode: "test" } }],
      "/app",
    );

    expect(generated.hasProviders).toBe(false);
    expect(generated.imports).toBe("");
    expect(generated.runtime).not.toContain('name: "metadata"');
  });
});

describe("integration providers on a renderer that compiles its own components", () => {
  // A renderer shaped like Svelte: it can host function components, and it
  // compiles its own, so Farm marks the ones it wires up.
  const COMPILING_RENDERER = {
    name: "svelte",
    componentExtensions: [".svelte"],
    capabilities: { functionComponents: true },
  } as any;

  function createRenderer(component: unknown, runtimeExtras: Record<string, unknown> = {}) {
    const marked: unknown[] = [];
    const acme = defineIntegration({
      category: "custom",
      type: "acme",
      instance: {},
      providers: [{ name: "acme", type: "client", component: component as never }],
    });
    const renderer = new ServerRenderer(
      {
        root: process.cwd(),
        outDir: ".farm-integration-provider-test",
        integrations: { acme },
        renderer: COMPILING_RENDERER,
      } as any,
      {} as any,
    );
    (renderer as any).rendererRuntime = {
      createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({
        type,
        props,
        children,
      }),
      markFunctionComponent: (value: unknown) => {
        marked.push(value);
        return value;
      },
      ...runtimeExtras,
    };
    return { renderer, marked };
  }

  it("renders instead of throwing, and marks the plain function component", async () => {
    // Production gates on the functionComponents capability; development used
    // to gate on the renderer being React, so this threw on every dev render.
    function AcmeProvider() {
      return null;
    }
    const { renderer, marked } = createRenderer(AcmeProvider);

    const wrapped = await (renderer as any).wrapWithIntegrationProviders({ leaf: true });

    expect((wrapped as any).type).toBe(AcmeProvider);
    expect(marked).toEqual([AcmeProvider]);
  });

  it("explains itself when the renderer cannot host function components", async () => {
    const { renderer } = createRenderer(() => null);
    (renderer as any).config.renderer = {
      name: "legacy",
      capabilities: { functionComponents: false },
    };

    await expect((renderer as any).wrapWithIntegrationProviders({ leaf: true })).rejects.toThrow(
      /requires a renderer that can host function components/,
    );
  });
});
