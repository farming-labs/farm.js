import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { readFarmI18nCatalogs } from "../i18n/catalog";
import { isFarmI18nCatalogFile, resolveFarmI18nConfig } from "../i18n/config";
import {
  createFarmLocaleCookie,
  getFarmLocaleVaryHeaders,
  matchFarmLocale,
  resolveFarmLocaleRequest,
} from "../i18n/resolver";
import { resolveFarmTrailingSlashRedirect } from "../trailing-slash";
import { FarmI18nRuntime } from "../i18n/runtime";
import {
  _runWithFarmI18nRequest,
  createTranslator,
  format,
  getLocale,
  getLocaleSource,
  t,
  _setDefaultFarmI18nRuntime,
} from "../i18n/server";
import { renderFarmI18nTypes } from "../i18n/type-generator";
import { localizeFarmHref, localizeFarmPathname, resolveFarmLocalePath } from "../i18n/routing";
import { getFarmDataCache, unstable_cache } from "../cache";
import { t as clientT, _hydrateFarmI18n } from "../i18n/client-runtime";

describe("Farm i18n configuration", () => {
  it("resolves production defaults and canonical locales", () => {
    const config = resolveFarmI18nConfig(
      {
        locales: ["en-us", "am"],
        defaultLocale: "en-us",
      },
      { root: "/app", mode: "production" },
    );

    expect(config).toMatchObject({
      enabled: true,
      basePath: "/",
      locales: ["en-US", "am"],
      defaultLocale: "en-US",
      fallbackLocale: "en-US",
      messages: resolve("/app", "src", "messages"),
      routing: "prefix-except-default",
      detection: ["url", "cookie", "accept-language"],
      strict: true,
      cookie: {
        name: "farm_locale",
        secure: true,
      },
    });
  });

  it("rejects invalid locale relationships", () => {
    expect(() => resolveFarmI18nConfig({ locales: ["en"], defaultLocale: "am" })).toThrow(
      'i18n.defaultLocale "am" must be included',
    );

    expect(() => resolveFarmI18nConfig({ locales: ["en", "en"], defaultLocale: "en" })).toThrow(
      "must not contain duplicate locales",
    );
  });

  it("rejects cookie settings that cannot be serialized safely", () => {
    const base = { locales: ["en"], defaultLocale: "en" } as const;

    expect(() => resolveFarmI18nConfig({ ...base, cookie: { path: "/; HttpOnly" } })).toThrow(
      "without attributes",
    );
    expect(() => resolveFarmI18nConfig({ ...base, cookie: { path: "/docs\\admin" } })).toThrow(
      "backslashes",
    );
    expect(() => resolveFarmI18nConfig({ ...base, cookie: { path: "/docs/%2Fadmin" } })).toThrow(
      "percent-encoded path separators",
    );
    expect(() =>
      resolveFarmI18nConfig({ ...base, cookie: { sameSite: "invalid" as "lax" } }),
    ).toThrow('must be "lax", "strict", or "none"');
  });

  it("serializes a validated custom locale cookie", () => {
    const config = resolveFarmI18nConfig({
      locales: ["en"],
      defaultLocale: "en",
      cookie: { path: "/docs", sameSite: "strict", secure: true },
    });

    expect(createFarmLocaleCookie("en", config)).toBe(
      "farm_locale=en; Max-Age=31536000; Path=/docs; SameSite=Strict; Secure",
    );
  });
});

describe("Farm locale routing", () => {
  const config = resolveFarmI18nConfig({
    locales: ["en", "am", "fr"],
    defaultLocale: "en",
  });

  it("strips and creates locale prefixes", () => {
    expect(resolveFarmLocalePath("/am/account", config)).toEqual({
      locale: "am",
      pathname: "/account",
      explicit: true,
    });
    expect(localizeFarmPathname("/account", "en", config)).toBe("/account");
    expect(localizeFarmPathname("/account", "am", config)).toBe("/am/account");
    expect(localizeFarmHref("/account?tab=profile#name", "am", config)).toBe(
      "/am/account?tab=profile#name",
    );
    expect(resolveFarmLocalePath("/AM/account", config)).toEqual({
      locale: "am",
      pathname: "/account",
      explicit: true,
    });
  });

  it("supports always-prefixed routes", () => {
    const always = { ...config, routing: "prefix-always" as const };
    expect(localizeFarmPathname("/", "en", always)).toBe("/en");
    expect(localizeFarmPathname("/am/account", "en", always)).toBe("/en/account");
  });

  it("preserves the application base path around locale prefixes", () => {
    const based = resolveFarmI18nConfig(
      {
        locales: ["en", "fr"],
        defaultLocale: "en",
      },
      { basePath: "/app" },
    );

    expect(resolveFarmLocalePath("/app/fr/account", based)).toEqual({
      locale: "fr",
      pathname: "/account",
      explicit: true,
    });
    expect(localizeFarmPathname("/account", "en", based)).toBe("/app/account");
    expect(localizeFarmPathname("/app/fr/account", "en", based)).toBe("/app/account");
    expect(localizeFarmHref("/app/account?tab=profile#name", "fr", based)).toBe(
      "/app/fr/account?tab=profile#name",
    );
  });
});

describe("Farm locale request signals", () => {
  const config = resolveFarmI18nConfig({
    locales: ["en", "am", "fr"],
    defaultLocale: "en",
  });

  it("gives an explicit URL locale precedence", () => {
    const resolution = resolveFarmLocaleRequest(
      new Request("https://farm.test/am/dashboard", {
        headers: {
          cookie: "farm_locale=fr",
          "accept-language": "en",
        },
      }),
      config,
    );

    expect(resolution).toMatchObject({
      locale: "am",
      source: "url",
      pathname: "/dashboard",
      persist: false,
    });
    expect(resolution.redirect).toBeUndefined();
  });

  it("uses cookie before weighted Accept-Language", () => {
    expect(
      resolveFarmLocaleRequest(
        new Request("https://farm.test/dashboard", {
          headers: {
            cookie: "farm_locale=fr",
            "accept-language": "am;q=1,en;q=0.8",
          },
        }),
        config,
      ),
    ).toMatchObject({
      locale: "fr",
      source: "cookie",
      redirect: "/fr/dashboard",
    });
  });

  it("keeps locale redirects beneath the application base path", () => {
    const based = resolveFarmI18nConfig(
      {
        locales: ["en", "fr"],
        defaultLocale: "en",
      },
      { basePath: "/app" },
    );

    expect(
      resolveFarmLocaleRequest(
        new Request("https://farm.test/app/products", {
          headers: { "accept-language": "fr" },
        }),
        based,
      ),
    ).toMatchObject({
      locale: "fr",
      pathname: "/products",
      redirect: "/app/fr/products",
    });
    expect(
      resolveFarmLocaleRequest(new Request("https://farm.test/app/fr/products"), based),
    ).toMatchObject({
      locale: "fr",
      source: "url",
      pathname: "/products",
      redirect: undefined,
    });
  });

  it("matches regional browser languages to a supported base locale", () => {
    expect(
      resolveFarmLocaleRequest(
        new Request("https://farm.test/", {
          headers: { "accept-language": "am-ET,fr;q=0.8" },
        }),
        config,
      ),
    ).toMatchObject({
      locale: "am",
      source: "accept-language",
      redirect: "/am",
    });
  });

  it("validates Accept-Language quality values and honors wildcard exclusions", () => {
    expect(
      resolveFarmLocaleRequest(
        new Request("https://farm.test/", {
          headers: { "accept-language": "fr;q=2,am;q=0.8" },
        }),
        config,
      ),
    ).toMatchObject({ locale: "am", source: "accept-language", redirect: "/am" });

    expect(
      resolveFarmLocaleRequest(
        new Request("https://farm.test/", {
          headers: { "accept-language": "*;q=0.8,en;q=0" },
        }),
        config,
      ),
    ).toMatchObject({ locale: "am", source: "accept-language", redirect: "/am" });

    expect(
      resolveFarmLocaleRequest(
        new Request("https://farm.test/", {
          headers: { "accept-language": "*;q=0" },
        }),
        config,
      ),
    ).toMatchObject({ locale: "en", source: "default" });
  });

  it("ignores malformed cookie names instead of failing the request", () => {
    expect(
      resolveFarmLocaleRequest(
        new Request("https://farm.test/", {
          headers: {
            cookie: "%E0%A4%A=broken; farm_locale=fr",
          },
        }),
        config,
      ),
    ).toMatchObject({ locale: "fr", source: "cookie" });
  });

  it("never locale-redirects APIs or Farm internals", () => {
    const headers = { "accept-language": "am" };
    expect(
      resolveFarmLocaleRequest(new Request("https://farm.test/api/users", { headers }), config)
        .redirect,
    ).toBeUndefined();
    expect(
      resolveFarmLocaleRequest(
        new Request("https://farm.test/__farm/page-data", { headers }),
        config,
      ).redirect,
    ).toBeUndefined();
  });

  it("varies signal-resolved responses while keeping URL locales cacheable", () => {
    const detected = resolveFarmLocaleRequest(
      new Request("https://farm.test/", { headers: { "accept-language": "am" } }),
      config,
    );
    const explicit = resolveFarmLocaleRequest(new Request("https://farm.test/am"), config);

    expect(getFarmLocaleVaryHeaders(config, detected)).toEqual(["Cookie", "Accept-Language"]);
    expect(getFarmLocaleVaryHeaders(config, explicit)).toEqual([]);
  });
});

describe("Farm regional locale fallback", () => {
  it("prefers a configured base language over a regional sharing the primary subtag", () => {
    expect(matchFarmLocale("en-US", ["en-GB", "en"])).toBe("en");
    expect(matchFarmLocale("en-GB", ["en-US", "en"])).toBe("en");
  });

  it("still falls back to a regional variant when no base language is configured", () => {
    expect(matchFarmLocale("en-US", ["en-GB"])).toBe("en-GB");
    expect(matchFarmLocale("en-US", ["en-AU", "en-GB"])).toBe("en-AU");
  });

  it("keeps exact regional matches ahead of a configured base language", () => {
    expect(matchFarmLocale("en-US", ["en", "en-US"])).toBe("en-US");
    expect(matchFarmLocale("en-GB", ["en", "en-GB"])).toBe("en-GB");
  });

  it("resolves an Accept-Language regional request to the configured base language", () => {
    const cfg = resolveFarmI18nConfig({
      locales: ["en-GB", "en"],
      defaultLocale: "en-GB",
    });

    expect(
      resolveFarmLocaleRequest(
        new Request("https://farm.test/", {
          headers: { "accept-language": "en-US,en;q=0.9" },
        }),
        cfg,
      ),
    ).toMatchObject({ locale: "en", source: "accept-language" });
  });

  it("resolves a regional cookie value to the configured base language", () => {
    const cfg = resolveFarmI18nConfig({
      locales: ["en-GB", "en"],
      defaultLocale: "en-GB",
    });

    expect(
      resolveFarmLocaleRequest(
        new Request("https://farm.test/dashboard", {
          headers: { cookie: "farm_locale=en-US" },
        }),
        cfg,
      ),
    ).toMatchObject({ locale: "en", source: "cookie" });
  });
});

describe("Farm ICU catalogs", () => {
  it("loads nested catalogs, validates variables, and formats plurals", async () => {
    const root = await createCatalogFixture({
      en: {
        home: { welcome: "Welcome, {name}!" },
        cart: {
          items:
            "{count, plural, =0 {Your cart is empty} one {You have # item} other {You have # items}}",
        },
      },
      am: {
        home: { welcome: "Hello, {name}!" },
        cart: {
          items: "{count, plural, =0 {No items} one {You have # item} other {You have # items}}",
        },
      },
    });
    const config = resolveFarmI18nConfig(
      { locales: ["en", "am"], defaultLocale: "en", strict: true },
      { root },
    );
    const bundle = await readFarmI18nCatalogs(config);

    expect(bundle.catalogs.en["home.welcome"]).toBe("Welcome, {name}!");
    expect(bundle.signatures).toEqual({
      "home.welcome": { name: "string" },
      "cart.items": { count: "number" },
    });

    const runtime = new FarmI18nRuntime(config, bundle.catalogs);
    expect(runtime.translate("en", "home.welcome", { name: "Kinfe" })).toBe("Welcome, Kinfe!");
    expect(runtime.translate("en", "cart.items", { count: 3 })).toBe("You have 3 items");
  });

  it("accepts message keys that collide with Object.prototype members", async () => {
    const root = await createCatalogFixture({
      en: { labels: { toString: "As text", constructor: "Builder" }, valueOf: "Value" },
      am: { labels: { toString: "Text", constructor: "Builder" }, valueOf: "Value" },
    });
    const config = resolveFarmI18nConfig(
      { locales: ["en", "am"], defaultLocale: "en", strict: true },
      { root },
    );

    const bundle = await readFarmI18nCatalogs(config);
    expect(bundle.catalogs.en["labels.toString"]).toBe("As text");
    expect(bundle.catalogs.en["valueOf"]).toBe("Value");
  });

  it("does not resolve prototype-named keys to inherited Object members at runtime", () => {
    const config = resolveFarmI18nConfig({ locales: ["en"], defaultLocale: "en", strict: false });
    const runtime = new FarmI18nRuntime(config, { en: { greeting: "Hello" } });

    // Keys named after Object.prototype members that are absent from the catalog
    // must read as missing, not as the inherited prototype value.
    expect(runtime.hasMessage("en", "toString")).toBe(false);
    expect(runtime.hasMessage("en", "valueOf")).toBe(false);
    // Non-strict lookup falls back to the key string instead of throwing an
    // opaque IntlMessageFormat error from an inherited function value.
    expect(runtime.translate("en", "toString")).toBe("toString");
  });

  it("still reports prototype-named keys missing from a locale in strict mode", async () => {
    const root = await createCatalogFixture({
      en: { toString: "As text" },
      am: {},
    });
    const config = resolveFarmI18nConfig(
      { locales: ["en", "am"], defaultLocale: "en", strict: true },
      { root },
    );

    await expect(readFarmI18nCatalogs(config)).rejects.toThrow(
      "does not match the default catalog",
    );
  });

  it("fails strict validation when locale keys or variables differ", async () => {
    const root = await createCatalogFixture({
      en: { greeting: "Hello, {name}!", complete: "Done" },
      am: { greeting: "Hello, {person}!" },
    });
    const config = resolveFarmI18nConfig(
      { locales: ["en", "am"], defaultLocale: "en", strict: true },
      { root },
    );

    await expect(readFarmI18nCatalogs(config)).rejects.toThrow(
      "does not match the default catalog",
    );
  });

  it("generates locale, key, and variable declarations", () => {
    const output = renderFarmI18nTypes(["en", "am"], {
      "home.welcome": { name: "string" },
      "cart.items": { count: "number" },
      "home.title": {},
    });

    expect(output).toContain('"am": true');
    expect(output).toContain('"home.welcome": { "name": string }');
    expect(output).toContain('"cart.items": { "count": number }');
    expect(output).toContain('"home.title": Record<never, never>');
  });
});

describe("Farm i18n catalog file classifier", () => {
  const projectRoot = resolve(".tmp-i18n-catalog-classifier");
  const projectFile = (...segments: string[]) => join(projectRoot, ...segments);

  it("matches per-locale catalogs under the default flat layout", () => {
    const config = resolveFarmI18nConfig(
      { locales: ["en-US", "am"], defaultLocale: "en-US" },
      { root: projectRoot },
    );
    expect(isFarmI18nCatalogFile(config, projectFile("src", "messages", "en-US.json"))).toBe(true);
    expect(isFarmI18nCatalogFile(config, projectFile("src", "messages", "am.json"))).toBe(true);
  });

  it("matches per-locale catalogs under the {locale}-templated layout", () => {
    const config = resolveFarmI18nConfig(
      {
        locales: ["en-US", "am"],
        defaultLocale: "en-US",
        messages: "content/locales/{locale}/app.json",
      },
      { root: projectRoot },
    );
    expect(
      isFarmI18nCatalogFile(config, projectFile("content", "locales", "en-US", "app.json")),
    ).toBe(true);
    expect(isFarmI18nCatalogFile(config, projectFile("content", "locales", "am", "app.json"))).toBe(
      true,
    );
  });

  it("rejects unrelated files beneath a templated messages base directory", () => {
    const config = resolveFarmI18nConfig(
      {
        locales: ["en-US"],
        defaultLocale: "en-US",
        messages: "content/locales/{locale}/app.json",
      },
      { root: projectRoot },
    );
    expect(
      isFarmI18nCatalogFile(config, projectFile("content", "locales", "en-US", "app.json")),
    ).toBe(true);
    expect(isFarmI18nCatalogFile(config, projectFile("content", "locales", "_shared.json"))).toBe(
      false,
    );
    expect(isFarmI18nCatalogFile(config, projectFile("content", "locales", "fr", "app.json"))).toBe(
      false,
    );
  });

  it("normalizes backslash separators on both the messages path and the edited file", () => {
    const config = {
      enabled: true,
      locales: ["en-US"],
      messages: "C:\\app\\content\\locales\\{locale}\\app.json",
    };
    expect(isFarmI18nCatalogFile(config, "C:\\app\\content\\locales\\en-US\\app.json")).toBe(true);
    expect(isFarmI18nCatalogFile(config, "C:/app/content/locales/en-US/app.json")).toBe(true);
  });

  it("does not treat every project file as a catalog for a root-level template", () => {
    const config = resolveFarmI18nConfig(
      { locales: ["en", "am"], defaultLocale: "en", messages: "{locale}.json" },
      { root: projectRoot },
    );

    expect(isFarmI18nCatalogFile(config, projectFile("en.json"))).toBe(true);
    expect(isFarmI18nCatalogFile(config, projectFile("am.json"))).toBe(true);
    expect(isFarmI18nCatalogFile(config, projectFile("src", "app", "page.tsx"))).toBe(false);
  });

  it("does not match a sibling directory that only shares the flat-layout prefix", () => {
    const config = resolveFarmI18nConfig(
      { locales: ["en"], defaultLocale: "en", messages: "src/messages" },
      { root: projectRoot },
    );

    expect(isFarmI18nCatalogFile(config, projectFile("src", "messages", "en.json"))).toBe(true);
    expect(isFarmI18nCatalogFile(config, projectFile("src", "messages-backup", "en.json"))).toBe(
      false,
    );
  });

  it("returns false when i18n is disabled or the file is outside the messages tree", () => {
    const disabled = resolveFarmI18nConfig(false, { root: projectRoot });
    expect(isFarmI18nCatalogFile(disabled, projectFile("src", "messages", "en.json"))).toBe(false);

    const templated = resolveFarmI18nConfig(
      {
        locales: ["en-US"],
        defaultLocale: "en-US",
        messages: "content/locales/{locale}/app.json",
      },
      { root: projectRoot },
    );
    expect(isFarmI18nCatalogFile(templated, projectFile("src", "app", "page.tsx"))).toBe(false);
    expect(
      isFarmI18nCatalogFile(
        templated,
        join(resolve(".tmp-other-i18n-app"), "content", "locales", "en-US", "app.json"),
      ),
    ).toBe(false);
  });
});

describe("Farm server i18n context", () => {
  it("isolates locale signals and exposes translation and formatting APIs", async () => {
    const config = resolveFarmI18nConfig({
      locales: ["en", "am"],
      defaultLocale: "en",
      strict: true,
    });
    const runtime = new FarmI18nRuntime(config, {
      en: { "home.welcome": "Welcome, {name}!" },
      am: { "home.welcome": "Hello, {name}!" },
    });
    _setDefaultFarmI18nRuntime(runtime);

    await _runWithFarmI18nRequest(
      runtime,
      new Request("https://farm.test/am", { headers: { cookie: "farm_locale=en" } }),
      () => {
        expect(getLocale()).toBe("am");
        expect(getLocaleSource()).toBe("url");
        expect(t("home.welcome", { name: "Kinfe" })).toBe("Hello, Kinfe!");
        expect(format.number(1200)).toBe(new Intl.NumberFormat("am").format(1200));
      },
    );

    expect(createTranslator("en")("home.welcome", { name: "Kinfe" })).toBe("Welcome, Kinfe!");
  });

  it("supports rich, raw, and message-existence lookups", async () => {
    const config = resolveFarmI18nConfig({
      locales: ["en"],
      defaultLocale: "en",
      strict: true,
    });
    const runtime = new FarmI18nRuntime(config, {
      en: { "docs.read": "Read <strong>{name}</strong>" },
    });

    await _runWithFarmI18nRequest(runtime, new Request("https://farm.test/"), () => {
      expect(t.has("docs.read")).toBe(true);
      expect(t.raw("docs.read")).toBe("Read <strong>{name}</strong>");
      expect(
        t.rich("docs.read", {
          name: "the guide",
          strong: (chunks: unknown[]) => ({ element: "strong", chunks }),
        }),
      ).toEqual(["Read ", { element: "strong", chunks: ["the guide"] }]);
      expect(() =>
        t("docs.read", {
          name: "the guide",
          strong: (chunks: unknown[]) => ({ element: "strong", chunks }),
        }),
      ).toThrow("t.rich");
    });
  });

  it("partitions unstable cache entries by active locale", async () => {
    getFarmDataCache().clear();
    const config = resolveFarmI18nConfig({
      locales: ["en", "am"],
      defaultLocale: "en",
    });
    const runtime = new FarmI18nRuntime(config, { en: {}, am: {} });
    let calls = 0;
    const cached = unstable_cache(async () => `${getLocale()}:${++calls}`, ["locale-test"]);

    const run = (pathname: string) =>
      _runWithFarmI18nRequest(runtime, new Request(`https://farm.test${pathname}`), () => cached());

    await expect(run("/")).resolves.toBe("en:1");
    await expect(run("/")).resolves.toBe("en:1");
    await expect(run("/am")).resolves.toBe("am:2");
  });
});

describe("Farm i18n client message lookup", () => {
  function hydrate(messages: Record<string, string>) {
    _hydrateFarmI18n({
      locale: "en",
      source: "default",
      locales: ["en"],
      defaultLocale: "en",
      routing: "prefix-except-default",
      direction: "ltr",
      messages,
    } as any);
  }

  it("does not resolve inherited Object.prototype members as messages", () => {
    hydrate({ greeting: "Hello" });

    // Real own key still works.
    expect(clientT("greeting")).toBe("Hello");
    expect(clientT.has("greeting")).toBe(true);
    expect(clientT.raw("greeting")).toBe("Hello");

    // Prototype-named keys must not resolve to native methods (which would throw
    // in IntlMessageFormat on the client while the server renders the key).
    for (const key of ["toString", "constructor", "valueOf", "hasOwnProperty"]) {
      expect(clientT.has(key)).toBe(false);
      expect(clientT.raw(key)).toBe(key);
      expect(clientT(key)).toBe(key);
    }
  });
});

describe("Farm i18n with trailingSlash", () => {
  const config = resolveFarmI18nConfig({
    locales: ["en", "fr"],
    defaultLocale: "en",
    routing: "prefix-always",
  });

  // Replay the server's redirect ordering: i18n canonicalization first, then the
  // dedicated trailing-slash redirect (renderer.ts / universal-build.ts both do
  // this). With trailingSlash: true the two must converge, not loop.
  function stepOnce(pathname: string): { kind: string; to?: string } {
    const resolution = resolveFarmLocaleRequest(
      new Request(`https://farm.test${pathname}`),
      config,
    );
    if (resolution.redirect) return { kind: "i18n", to: resolution.redirect };
    const trailing = resolveFarmTrailingSlashRedirect(
      new URL(`https://farm.test${pathname}`),
      true,
    );
    if (trailing) return { kind: "trailing", to: trailing };
    return { kind: "render" };
  }

  it("converges instead of looping between the locale and trailing-slash redirects", () => {
    let pathname = "/en/about";
    const visited = new Set<string>();
    let step = stepOnce(pathname);
    let hops = 0;
    while (step.kind !== "render") {
      expect(hops++).toBeLessThan(6); // a loop would blow past this
      expect(visited.has(pathname + "->" + step.to)).toBe(false);
      visited.add(pathname + "->" + step.to);
      pathname = step.to!;
      step = stepOnce(pathname);
    }
    // trailingSlash: true settles on the slashed locale URL.
    expect(pathname).toBe("/en/about/");
  });

  it("still canonicalizes a non-trailing-slash locale difference", () => {
    // A casing/duplicate-slash difference is a real i18n redirect, not deferred.
    expect(
      resolveFarmLocaleRequest(new Request("https://farm.test/EN/about"), config).redirect,
    ).toBe("/en/about");
  });
});

async function createCatalogFixture(catalogs: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "farm-i18n-"));
  const messages = join(root, "src/messages");
  await mkdir(messages, { recursive: true });
  await Promise.all(
    Object.entries(catalogs).map(([locale, catalog]) =>
      writeFile(join(messages, `${locale}.json`), JSON.stringify(catalog)),
    ),
  );
  return root;
}
