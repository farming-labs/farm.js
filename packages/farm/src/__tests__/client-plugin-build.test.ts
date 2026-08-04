import { describe, expect, it } from "vitest";
import {
  generateFarmClientPluginEntryCode,
  resolveFarmClientPlugins,
} from "../client-plugin-build";
import { defineIntegration, resolveIntegrationPlugins } from "../integrations";
import { definePlugin } from "../plugin";

describe("client plugin build boundary", () => {
  it("resolves lifecycle hooks directly from definePlugin", () => {
    const setup = () => ({ ready: true });
    const plugins = [
      definePlugin({ name: "inline", client: { setup } }),
      definePlugin({ name: "server-only" }),
    ];

    const resolved = resolveFarmClientPlugins(plugins);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ name: "inline" });
    expect(resolved[0]?.definition.setup).toBe(setup);
  });

  it("generates inline hooks and embeds only explicitly public data", () => {
    const serverSecret = "must-not-reach-client";
    const plugin = definePlugin({
      name: "acme:analytics",
      version: "1.2.0",
      enforce: "post",
      setup() {
        return { serverSecret };
      },
      client: {
        public: { projectId: "storefront", sampleRate: 0.25 },
        setup({ public: config }) {
          return { projectId: config.projectId };
        },
        navigation: {
          rendered({ state, to }) {
            document.documentElement.dataset.analytics = `${state.projectId}:${to.pathname}`;
          },
        },
      },
    });

    const generated = generateFarmClientPluginEntryCode([plugin]);

    expect(generated.imports).toBe("");
    expect(generated.registrations).toContain('name: "acme:analytics"');
    expect(generated.registrations).toContain('version: "1.2.0"');
    expect(generated.registrations).toContain('enforce: "post"');
    expect(generated.registrations).toContain('"setup"');
    expect(generated.registrations).toContain('"navigation"');
    expect(generated.registrations).toContain("storefront");
    expect(generated.registrations).not.toContain(serverSecret);
    expect(generated.registrations).not.toContain("source");
  });

  it("does not serialize an owning integration or its instance", () => {
    const integration = defineIntegration({
      category: "auth",
      type: "private-instance",
      instance: { secret: "integration-secret-must-stay-server-side" },
      plugins: [
        definePlugin({
          name: "auth:client-lifecycle",
          client: {
            public: { enabled: true },
            setup({ public: config }) {
              return { enabled: config.enabled };
            },
          },
        }),
      ],
    });

    const generated = generateFarmClientPluginEntryCode(
      resolveIntegrationPlugins({ auth: integration }),
    );

    const registrations = Function(`return ${generated.registrations}`)();
    expect(generated.registrations).toContain('name: "auth:client-lifecycle"');
    expect(registrations[0].public).toEqual({ enabled: true });
    expect(generated.registrations).not.toContain("integration-secret-must-stay-server-side");
    expect(generated.registrations).not.toContain("private-instance");
  });

  it("emits valid JavaScript for methods, functions, and arrows", async () => {
    const generated = generateFarmClientPluginEntryCode([
      definePlugin({
        name: "syntax",
        client: {
          async setup() {
            const ready = () => true;
            return { ready: ready() };
          },
          hydration: {
            before: () => undefined,
            after: function after() {},
          },
        },
      }),
    ]);

    const registrations = Function(`return ${generated.registrations}`)();
    expect(registrations).toHaveLength(1);
    await expect(registrations[0].definition.setup()).resolves.toEqual({ ready: true });
    expect(registrations[0].definition.hydration.before()).toBeUndefined();
  });

  it("rejects non-JSON public data instead of dropping it", () => {
    expect(() =>
      resolveFarmClientPlugins([
        definePlugin({
          name: "unsafe",
          client: {
            public: { token: () => "secret" },
          },
        }),
      ]),
    ).toThrow('Client plugin "unsafe" at client.public.token cannot contain function values');

    expect(() =>
      resolveFarmClientPlugins([
        definePlugin({
          name: "unsafe-date",
          client: {
            public: { startedAt: new Date() },
          },
        }),
      ]),
    ).toThrow("must contain only plain objects and arrays");
  });

  it("rejects public data that JSON would silently reshape or omit", () => {
    const withSymbol = { projectId: "storefront" } as Record<PropertyKey, unknown>;
    withSymbol[Symbol("token")] = "secret";

    expect(() =>
      resolveFarmClientPlugins([
        definePlugin({ name: "symbol-key", client: { public: withSymbol } }),
      ]),
    ).toThrow("cannot contain symbol keys");

    const sparse = ["first", , "third"];
    expect(() =>
      resolveFarmClientPlugins([
        definePlugin({ name: "sparse-array", client: { public: sparse } }),
      ]),
    ).toThrow("at client.public.1 cannot contain sparse array slots");

    const withAccessor = Object.defineProperty({}, "token", {
      enumerable: true,
      get: () => "secret",
    });
    expect(() =>
      resolveFarmClientPlugins([
        definePlugin({ name: "accessor", client: { public: withAccessor } }),
      ]),
    ).toThrow("at client.public.token cannot contain accessor properties");
  });

  it("rejects the removed source API and unknown lifecycle fields", () => {
    expect(() =>
      resolveFarmClientPlugins([definePlugin({ name: "legacy", client: "./client.ts" as never })]),
    ).toThrow('Client plugin "legacy" client must be an object');

    expect(() =>
      resolveFarmClientPlugins([
        definePlugin({
          name: "unknown",
          client: { source: "./client.ts" } as never,
        }),
      ]),
    ).toThrow("unknown client.source option");
  });

  it("rejects accessors and native or bound lifecycle hooks", () => {
    const accessor = Object.defineProperty({}, "setup", {
      enumerable: true,
      get: () => () => undefined,
    });
    expect(() =>
      resolveFarmClientPlugins([
        definePlugin({ name: "accessor-hook", client: accessor as never }),
      ]),
    ).toThrow("client.setup cannot be an accessor");

    expect(() =>
      resolveFarmClientPlugins([
        definePlugin({
          name: "native-hook",
          client: { setup: Math.max as never },
        }),
      ]),
    ).toThrow("must be authored inline and cannot be native or bound");

    const bound = (() => undefined).bind(null);
    expect(() =>
      resolveFarmClientPlugins([definePlugin({ name: "bound-hook", client: { setup: bound } })]),
    ).toThrow("must be authored inline and cannot be native or bound");
  });
});
