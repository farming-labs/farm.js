import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BotError,
  bot,
  createBotKeys,
  defineBotProvider,
  type BotProvider,
  type BotProviderKeys,
} from "./index";

function acme(options?: BotProviderKeys): BotProvider {
  const keys = createBotKeys(
    {
      name: "acme",
      siteKeyEnv: "ACME_SITE_KEY",
      secretKeyEnv: "ACME_SECRET_KEY",
      testKeys: { siteKey: "acme-test-site", secretKey: "acme-test-secret" },
    },
    options,
  );
  return defineBotProvider({
    name: "acme",
    tokenField: "acme-response",
    csp: { "script-src": ["https://js.acme.example"], "frame-src": ["https://js.acme.example"] },
    client: () => ({
      widget: "acme-bot/widget",
      public: { name: "acme", siteKey: keys.siteKey() },
    }),
    verify: async () => ({ success: false, code: "rejected" }),
  });
}

beforeEach(() => {
  vi.stubEnv("ACME_SITE_KEY", "");
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const serverOnly: BotProvider = {
  name: "ip-reputation",
  verify: async () => ({ success: true }),
};

describe("the package", () => {
  it("keeps vendors out of the core, so other checkers never load them", () => {
    const sources = import.meta.glob<string>(["./*.ts", "./*.tsx", "!./*.test.*"], {
      query: "?raw",
      import: "default",
      eager: true,
    });
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    for (const [path, source] of Object.entries(sources)) {
      expect(`${path}: ${/turnstile|hcaptcha|recaptcha/i.test(source)}`).toBe(`${path}: false`);
      expect(`${path}: ${/(?:from\s+|import\s*\(?\s*)"\.\/captcha/.test(source)}`).toBe(
        `${path}: false`,
      );
    }
  });

  it("gives the captcha code no dependency, and only the public entry points", () => {
    const sources = import.meta.glob<string>(["./captcha/*.ts", "!./captcha/*.test.*"], {
      query: "?raw",
      import: "default",
      eager: true,
    });
    expect(Object.keys(sources).length).toBeGreaterThan(2);
    for (const [path, source] of Object.entries(sources)) {
      const imports = [...source.matchAll(/(?:from\s+|import\s*\(?\s*)"([^"]+)"/g)].map(
        (match) => match[1]!,
      );
      expect(
        imports.filter(
          (specifier) => !/^(?:\.\.\/(?:index|client)|\.\/[\w-]+)\.js$/.test(specifier),
        ),
        path,
      ).toEqual([]);
    }
  });
});

describe("bot", () => {
  it("keeps prerendered pages off the server, while still making it load the config", () => {
    // Farm treats `setup`, `runtime.close`, and request hooks as affecting every path.
    const plugin = bot({ provider: acme() });
    expect(plugin.setup).toBeUndefined();
    expect(plugin.runtime).toEqual({});
  });

  it("puts only public values in the client config", () => {
    const plugin = bot({
      provider: acme({ siteKey: "0x4AAAAAAApublic", secretKey: "0x4AAAAAAAsecret" }),
    });
    expect(plugin.name).toBe("farm:bot");
    expect((plugin.client!.public as any).config).toEqual({
      name: "acme",
      siteKey: "0x4AAAAAAApublic",
    });
    expect(JSON.stringify(plugin.client?.public)).not.toContain("secret");
  });

  it("reads the site key from the environment when the plugin is created", () => {
    vi.stubEnv("ACME_SITE_KEY", "hc-site-key");
    expect(bot({ provider: acme() }).client?.public).toMatchObject({
      config: { siteKey: "hc-site-key" },
    });
  });

  it("doesn't need the site key just to create the instance on the server", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => bot({ provider: acme() })).not.toThrow();
  });

  it("uses the provider's test site key outside production", () => {
    expect(bot({ provider: acme() }).client?.public).toMatchObject({
      config: { siteKey: "acme-test-site" },
    });
  });

  it("lets a production server start without the site key, and fails the build instead", () => {
    vi.stubEnv("NODE_ENV", "production");
    const plugin = bot({ provider: acme() });
    expect(plugin.client).toBeUndefined();
    expect(() => plugin.configure?.({ plugins: [plugin] }, {} as never)).toThrow(/ACME_SITE_KEY/);
  });

  it("allows test keys in production only when asked", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(bot({ provider: acme({ testKeys: true }) }).client?.public).toMatchObject({
      config: { siteKey: "acme-test-site" },
    });
  });

  it("rejects invalid options, reporting all of them", () => {
    expect(() => bot(undefined as never)).toThrow(/provider/);
    expect(() => bot({} as never)).toThrow(BotError);
    expect(() => bot({ provider: { name: "acme" } as never })).toThrow(
      /`verify` must be a function/,
    );
    expect(() => bot({ provider: serverOnly, hostnames: [], timeoutMs: 0 })).toThrow(
      /hostnames.*timeoutMs/,
    );
    for (const timeoutMs of [1500.5, 2 ** 31, Number.NaN]) {
      expect(() => bot({ provider: serverOnly, timeoutMs })).toThrow(/timeoutMs/);
    }
  });

  it("adds the widget to an app's CSP and leaves apps without one alone", async () => {
    const plugin = bot({ provider: acme() });
    const context = {} as never;

    expect((await plugin.configure?.({ plugins: [plugin] }, context))?.security).toBeUndefined();
    const next = await plugin.configure?.(
      { plugins: [plugin], security: { csp: "default-src 'self'" } },
      context,
    );
    expect(next?.security?.csp).toBe(
      "default-src 'self'; script-src 'self' https://js.acme.example; frame-src 'self' https://js.acme.example",
    );
  });

  it("rejects a second instance of the plugin", () => {
    const plugins = [bot({ provider: acme() }), bot({ provider: acme() })];
    expect(() => plugins[0]!.configure?.({ plugins }, {} as never)).toThrow(/once/);
  });

  it("keeps client hooks free of closure variables, because Farm compiles them from source", () => {
    const client = bot({ provider: acme() }).client!;
    const source = `${client.setup}\n${client.close}`.replace(/"[^"]*"/g, '""');
    for (const name of ["keys", "config", "siteKey", "client", "provider", "start"]) {
      expect(source).not.toMatch(new RegExp(`\\b${name}\\b(?!:)`));
    }
  });

  it("sends the browser the widget's path, its data, and the token field, and nothing else", () => {
    const client = bot({ provider: acme({ siteKey: "site" }) }).client!;
    expect(client.public).toEqual({
      widget: "acme-bot/widget",
      tokenField: "acme-response",
      config: expect.objectContaining({ name: "acme", siteKey: "site" }),
    });
  });

  it("leaves out what a provider doesn't have, because Farm refuses undefined in public data", () => {
    const provider = defineBotProvider({
      name: "bare",
      client: () => ({ widget: "bare-bot/widget" }),
      verify: async () => ({ success: false, code: "rejected" }),
    });
    expect(bot({ provider }).client!.public).toEqual({
      widget: "bare-bot/widget",
    });
  });

  it("points the browser hook at the provider's widget module", async () => {
    const provider = defineBotProvider({
      name: "acme",
      client: () => ({ widget: "/src/acme.widget.ts" }),
      verify: async () => ({ success: false, code: "rejected" }),
    });
    const plugin = bot({ provider });
    const next = await plugin.configure?.({ plugins: [plugin] }, {} as never);
    const [resolver] = (next!.vite as { plugins: any[] }).plugins;
    const resolve = vi.fn(async () => ({ id: "/app/src/acme.widget.ts" }));

    const widgetModule = "@farm.js/bot/provider-widget";
    expect(await resolver.resolveId.call({ resolve }, "other", undefined, {})).toBeUndefined();
    expect(await resolver.resolveId.call({ resolve }, widgetModule, undefined, {})).toEqual({
      id: "/app/src/acme.widget.ts",
    });
    expect(resolve).toHaveBeenCalledWith("/src/acme.widget.ts", undefined, { skipSelf: true });

    resolve.mockResolvedValueOnce(null as never);
    await expect(resolver.resolveId.call({ resolve }, widgetModule, undefined, {})).rejects.toThrow(
      /acme.*"\/src\/acme\.widget\.ts".*can't be found/,
    );
  });

  it("keeps widget code out of server bundles", async () => {
    const provider = defineBotProvider({
      name: "acme",
      client: () => ({ widget: "/src/acme.widget.ts" }),
      verify: async () => ({ success: false, code: "rejected" }),
    });
    const plugin = bot({ provider });
    const next = await plugin.configure?.({ plugins: [plugin] }, {} as never);
    const [resolver] = (next!.vite as { plugins: any[] }).plugins;
    const resolve = vi.fn();

    expect(
      await resolver.resolveId.call({ resolve }, "@farm.js/bot/provider-widget", undefined, {
        ssr: true,
      }),
    ).toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("only imports real package paths from the hook, so any bundle can resolve them", async () => {
    // A server bundle includes this hook's text, even for a provider with no browser half.
    const manifest = (await import("../package.json")) as { exports: Record<string, unknown> };
    const source = String(bot({ provider: acme() }).client!.setup);
    const paths = [...source.matchAll(/@farm\.js\/bot\/([\w-]+)/g)].map((match) => match[1]);

    expect(paths.length).toBe(2);
    for (const path of paths) expect(manifest.exports).toHaveProperty([`./${path}`]);
    expect(source).not.toContain("virtual:");
  });

  it("keeps the app's own Vite config, in either form", async () => {
    const provider = defineBotProvider({
      name: "acme",
      client: () => ({ widget: "/src/acme.widget.ts" }),
      verify: async () => ({ success: false, code: "rejected" }),
    });
    const plugin = bot({ provider });
    const own = { name: "own" };

    const object = await plugin.configure?.(
      { plugins: [plugin], vite: { base: "/x/", plugins: [own] } },
      {} as never,
    );
    expect((object!.vite as any).base).toBe("/x/");
    expect((object!.vite as any).plugins[1]).toBe(own);

    const fn = await plugin.configure?.(
      { plugins: [plugin], vite: () => ({ plugins: [own] }) },
      {} as never,
    );
    expect((fn!.vite as any)({}).plugins[1]).toBe(own);
  });

  it("reports a widget path that can't work from `configure`, not while loading config", () => {
    const provider = defineBotProvider({
      name: "relative",
      client: () => ({ widget: "./acme.widget.ts" }),
      verify: async () => ({ success: false, code: "rejected" }),
    });
    const plugin = bot({ provider });
    expect(() => plugin.configure?.({ plugins: [plugin] }, {} as never)).toThrow(/relative path/);
  });

  it("adds no browser code for a provider with no browser half", async () => {
    const plugin = bot({ provider: serverOnly });
    expect(plugin.client).toBeUndefined();
    expect(
      await plugin.configure?.(
        { plugins: [plugin], security: { csp: "default-src 'self'" } },
        {} as never,
      ),
    ).toBeUndefined();
  });

  it("uses a custom provider's own widget and CSP sources", async () => {
    const provider = defineBotProvider({
      name: "acme",
      tokenField: "acme-token",
      csp: { "script-src": ["https://js.acme.example"] },
      client: () => ({ widget: "acme-bot/widget", public: { siteKey: "acme-public" } }),
      verify: async () => ({ success: true as const, data: { score: 0.8 } }),
    });
    const plugin = bot({ provider });

    expect(plugin.client?.public).toEqual({
      widget: "acme-bot/widget",
      tokenField: "acme-token",
      config: { siteKey: "acme-public" },
    });
    const next = await plugin.configure?.(
      { plugins: [plugin], security: { csp: "script-src 'self'" } },
      {} as never,
    );
    expect(next?.security?.csp).toBe("script-src 'self' https://js.acme.example");

    const check = await plugin.verify("token");
    expect(check.success && check.data?.score).toBe(0.8);
  });
});
