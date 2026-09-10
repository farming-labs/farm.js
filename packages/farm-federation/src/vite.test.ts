import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFarmFederationVitePlugins,
  restrictPluginOptionToClient,
  restrictPluginToClient,
} from "./vite";

describe("Farm federation Vite boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps the exposed-module map isolated from Farm's application entry", () => {
    const plugins = createFarmFederationVitePlugins(
      {
        remoteAliases: [],
        upstream: { name: "checkout" },
      },
      () => [],
    );
    const config = plugins[1]!.config as (config: object) => void;
    const existingGroup = { name: "existing", test: /src/ };
    const output = { codeSplitting: { groups: [existingGroup] } };

    config({ build: { rollupOptions: { output } } });

    expect(output.codeSplitting.groups).toEqual([
      existingGroup,
      {
        name: "federation-exposes",
        test: /virtual:mf-exposes:/,
        priority: 999_999,
      },
    ]);
  });

  it("keeps upstream plugins out of production SSR builds", () => {
    const plugin = restrictPluginToClient({ name: "upstream", apply: "build" });
    const apply = plugin.apply as (config: object, environment: { command: string }) => boolean;

    expect(apply.call({}, { build: { ssr: true } }, { command: "build" })).toBe(false);
    expect(apply.call({}, { build: { ssr: false } }, { command: "build" })).toBe(true);
    expect(apply.call({}, { build: { ssr: false } }, { command: "serve" })).toBe(false);
  });

  it("preserves asynchronous plugins such as declaration generation", async () => {
    const delayed = Promise.resolve([{ name: "module-federation-dts-build", apply: "build" }]);
    const wrapped = restrictPluginOptionToClient(delayed) as Promise<
      Array<{ apply: (config: object, environment: { command: string }) => boolean }>
    >;
    const [plugin] = await wrapped;

    expect(plugin!.apply({ build: { ssr: false } }, { command: "build" })).toBe(true);
    expect(plugin!.apply({ build: { ssr: true } }, { command: "build" })).toBe(false);
  });

  it("does not start upstream dev workers during production route discovery", () => {
    vi.stubEnv("NODE_ENV", "production");
    const plugin = restrictPluginToClient({ name: "upstream-dev", apply: "serve" });
    const apply = plugin.apply as (config: object, environment: { command: string }) => boolean;

    expect(apply.call({}, { build: { ssr: false } }, { command: "serve" })).toBe(false);
  });

  it("does not run upstream resolution, loading, or transforms for server modules", () => {
    const transform = vi.fn(() => ({ code: "client" }));
    const plugin = restrictPluginToClient({ name: "upstream", transform });
    const wrapped = plugin.transform as (...args: unknown[]) => unknown;

    expect(wrapped.call({}, "source", "/src/file.ts", { ssr: true })).toBeNull();
    expect(transform).not.toHaveBeenCalled();
    expect(wrapped.call({}, "source", "/src/file.ts", { ssr: false })).toEqual({ code: "client" });
    expect(transform).toHaveBeenCalledOnce();
  });

  it("blocks configured remote imports from Farm's server graph", () => {
    const plugins = createFarmFederationVitePlugins(
      {
        remoteAliases: ["checkout"],
        upstream: { name: "host" },
      },
      () => [],
    );
    const guard = plugins[0]!;
    const resolveId = guard.resolveId as (...args: unknown[]) => unknown;

    expect(resolveId.call({}, "local-module", "/src/page.tsx", { ssr: true })).toBeNull();
    expect(() =>
      resolveId.call({}, "checkout/CheckoutButton", "/src/page.tsx", { ssr: true }),
    ).toThrow("browser modules only");
    expect(
      resolveId.call({}, "checkout/CheckoutButton", "/src/page.tsx", { ssr: false }),
    ).toBeNull();
  });

  it("replaces the browser runtime with a small server guard", () => {
    const plugins = createFarmFederationVitePlugins(
      {
        remoteAliases: ["checkout"],
        upstream: { name: "host" },
      },
      () => [],
    );
    const guard = plugins[0]!;
    const resolveId = guard.resolveId as (...args: unknown[]) => unknown;
    const load = guard.load as (id: string) => unknown;

    const serverId = resolveId.call({}, "@module-federation/runtime", "/src/client.ts", {
      ssr: true,
    });
    expect(serverId).toBe("\0farm:federation:server-runtime");
    expect(load(serverId as string)).toContain("must be loaded after hydration");
    expect(
      resolveId.call({}, "@module-federation/runtime", "/src/client.ts", { ssr: false }),
    ).toBeNull();
  });

  it("records Farm's hashed remote entry in generated manifests", () => {
    const plugins = createFarmFederationVitePlugins(
      {
        remoteAliases: [],
        upstream: { name: "checkout" },
      },
      () => [],
    );
    const manifestPlugin = plugins.at(-1)!;
    const generateBundle = manifestPlugin.generateBundle as (
      output: unknown,
      bundle: Record<string, unknown>,
    ) => void;
    const manifest = {
      type: "asset",
      fileName: "mf-manifest.json",
      source: JSON.stringify({ metaData: { remoteEntry: { path: "", type: "module" } } }),
    };

    generateBundle(
      {},
      {
        "chunks/remote-h123.js": {
          type: "chunk",
          fileName: "chunks/remote-h123.js",
          facadeModuleId: "virtual:mf-REMOTE_ENTRY_ID:checkout",
        },
        "mf-manifest.json": manifest,
      },
    );

    expect(JSON.parse(manifest.source)).toMatchObject({
      metaData: { remoteEntry: { name: "chunks/remote-h123.js" } },
    });
  });

  it("preserves object hook metadata and its original context", () => {
    const context = { environment: { name: "client" } };
    const handler = vi.fn(function (this: unknown) {
      return this;
    });
    const plugin = restrictPluginToClient({
      name: "upstream",
      load: { order: "pre", handler },
    });
    const load = plugin.load as { order: string; handler: (...args: unknown[]) => unknown };

    expect(load.order).toBe("pre");
    expect(load.handler.call(context, "/virtual", { ssr: false })).toBe(context);
    expect(handler).toHaveBeenCalledOnce();
  });
});
