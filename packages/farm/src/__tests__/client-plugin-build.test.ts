import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  generateFarmClientPluginEntryCode,
  resolveFarmClientPlugins,
} from "../client-plugin-build";
import { definePlugin } from "../plugin";

describe("client plugin build boundary", () => {
  it("resolves local, package, and file URL client modules", () => {
    const root = path.resolve("/workspace/app");
    const plugins = [
      definePlugin({ name: "local", client: "./src/plugins/local.client.ts" }),
      definePlugin({ name: "package", client: "@acme/farm-plugin/client" }),
      definePlugin({
        name: "layer",
        client: pathToFileURL("/workspace/layer/client.js"),
      }),
    ];

    expect(resolveFarmClientPlugins(plugins, root).map(({ source }) => source)).toEqual([
      path.join(root, "src/plugins/local.client.ts"),
      "@acme/farm-plugin/client",
      "/workspace/layer/client.js",
    ]);
  });

  it("generates imports and embeds only explicitly public options", () => {
    const serverSecret = "must-not-reach-client";
    const plugin = definePlugin({
      name: "acme:analytics",
      version: "1.2.0",
      enforce: "post",
      setup() {
        return { serverSecret };
      },
      client: {
        source: "./src/plugins/analytics.client.ts",
        public: { projectId: "storefront", sampleRate: 0.25 },
      },
    });

    const generated = generateFarmClientPluginEntryCode([plugin], "/workspace/app");

    expect(generated.imports).toContain(
      'import farmClientPlugin0 from "/workspace/app/src/plugins/analytics.client.ts";',
    );
    expect(generated.registrations).toContain('name: "acme:analytics"');
    expect(generated.registrations).toContain('version: "1.2.0"');
    expect(generated.registrations).toContain('enforce: "post"');
    expect(generated.registrations).toContain("storefront");
    expect(generated.imports + generated.registrations).not.toContain(serverSecret);
    expect(generated.imports + generated.registrations).not.toContain("setup");
  });

  it("rejects non-JSON public options instead of dropping them", () => {
    expect(() =>
      resolveFarmClientPlugins(
        [
          definePlugin({
            name: "unsafe",
            client: {
              source: "./client.ts",
              public: { token: () => "secret" },
            },
          }),
        ],
        "/workspace/app",
      ),
    ).toThrow('Client plugin "unsafe" at public.token cannot contain function values');

    expect(() =>
      resolveFarmClientPlugins(
        [
          definePlugin({
            name: "unsafe-date",
            client: {
              source: "./client.ts",
              public: { startedAt: new Date() },
            },
          }),
        ],
        "/workspace/app",
      ),
    ).toThrow("must contain only plain objects and arrays");
  });

  it("rejects public options that JSON would silently reshape or omit", () => {
    const withSymbol = { projectId: "storefront" } as Record<PropertyKey, unknown>;
    withSymbol[Symbol("token")] = "secret";

    expect(() =>
      resolveFarmClientPlugins(
        [
          definePlugin({
            name: "symbol-key",
            client: { source: "./client.ts", public: withSymbol },
          }),
        ],
        "/workspace/app",
      ),
    ).toThrow("cannot contain symbol keys");

    const sparse = ["first", , "third"];
    expect(() =>
      resolveFarmClientPlugins(
        [
          definePlugin({
            name: "sparse-array",
            client: { source: "./client.ts", public: sparse },
          }),
        ],
        "/workspace/app",
      ),
    ).toThrow("at public.1 cannot contain sparse array slots");

    const withAccessor = Object.defineProperty({}, "token", {
      enumerable: true,
      get: () => "secret",
    });
    expect(() =>
      resolveFarmClientPlugins(
        [
          definePlugin({
            name: "accessor",
            client: { source: "./client.ts", public: withAccessor },
          }),
        ],
        "/workspace/app",
      ),
    ).toThrow("at public.token cannot contain accessor properties");
  });

  it("rejects remote client modules", () => {
    expect(() =>
      resolveFarmClientPlugins(
        [
          definePlugin({
            name: "remote",
            client: new URL("https://example.com/plugin.js"),
          }),
        ],
        "/workspace/app",
      ),
    ).toThrow("must use a file URL, project path, or package specifier");

    for (const source of [
      "https://example.com/plugin.js",
      "data:text/javascript,export default {}",
      "//example.com/plugin.js",
    ]) {
      expect(() =>
        resolveFarmClientPlugins(
          [definePlugin({ name: "remote-string", client: source })],
          "/workspace/app",
        ),
      ).toThrow("must use a file URL, project path, or package specifier");
    }
  });
});
