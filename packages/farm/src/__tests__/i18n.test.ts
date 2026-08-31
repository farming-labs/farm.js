import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { readFarmI18nCatalogs } from "../i18n/catalog";
import { resolveFarmI18nConfig } from "../i18n/config";
import { getFarmLocaleVaryHeaders, resolveFarmLocaleRequest } from "../i18n/resolver";
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
