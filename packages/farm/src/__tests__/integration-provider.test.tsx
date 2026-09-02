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
