import { describe, expect, it } from "vitest";
import { resolveFarmI18nConfig } from "../i18n/config";
import { FarmI18nRuntime } from "../i18n/runtime";
import { getFarmI18nClientSnapshot } from "../i18n/server";
import { ServerRenderer } from "../server/renderer";

function createRenderer(routing: "none" | "prefix-except-default" = "none") {
  const i18n = resolveFarmI18nConfig(
    { locales: ["en", "fr"], defaultLocale: "en", routing },
    { root: "/test", mode: "production" },
  );
  const config = { root: "/test", srcDir: "src", outDir: "dist", basePath: "/", i18n };
  const renderer = new ServerRenderer(config as any, {} as any, new FarmI18nRuntime(i18n));
  return renderer as any;
}

function request(locale: string, pathname: string) {
  return new Request(`http://localhost${pathname}`, {
    headers: { "accept-language": locale },
  });
}

// The shell cache is a process-wide singleton, so each test uses its own path.
describe("PPR shell cache and locale", () => {
  it("does not serve a shell cached in one locale to another locale", async () => {
    const renderer = createRenderer();
    const french = '<html lang="fr" dir="ltr">bonjour</html>';

    await renderer.cachePPRShell({ pathname: "/cross", search: "", locale: "fr" }, french);

    expect(await renderer.getCachedPPRShell("/cross", "", "en")).toBeFalsy();
  });

  it("serves a cached shell back to the same locale", async () => {
    const renderer = createRenderer();
    const french = '<html lang="fr" dir="ltr">bonjour</html>';

    await renderer.cachePPRShell({ pathname: "/same", search: "", locale: "fr" }, french);

    // Guards the read and write sides against drifting apart, which would silently
    // stop the shell cache from ever hitting.
    expect((await renderer.getCachedPPRShell("/same", "", "fr"))?.value?.html).toBe(french);
  });

  it("keeps a separate shell per locale for one path", async () => {
    const renderer = createRenderer();
    const french = '<html lang="fr">bonjour</html>';
    const english = '<html lang="en">hello</html>';

    await renderer.cachePPRShell({ pathname: "/both", search: "", locale: "fr" }, french);
    await renderer.cachePPRShell({ pathname: "/both", search: "", locale: "en" }, english);

    expect((await renderer.getCachedPPRShell("/both", "", "fr"))?.value?.html).toBe(french);
    expect((await renderer.getCachedPPRShell("/both", "", "en"))?.value?.html).toBe(english);
  });

  it("still separates entries by search params within one locale", async () => {
    const renderer = createRenderer();
    const first = "<html>page one</html>";

    await renderer.cachePPRShell({ pathname: "/search", search: "?page=1", locale: "fr" }, first);

    expect((await renderer.getCachedPPRShell("/search", "?page=1", "fr"))?.value?.html).toBe(first);
    expect(await renderer.getCachedPPRShell("/search", "?page=2", "fr")).toBeFalsy();
  });

  it("captures the locale the request resolved to", async () => {
    const renderer = createRenderer();

    const resolved = async (locale: string) =>
      renderer.runWithRequestContext(
        request(locale, "/resolved"),
        async () => getFarmI18nClientSnapshot()?.locale ?? "",
      );

    expect(await resolved("fr")).toBe("fr");
    expect(await resolved("en")).toBe("en");
  });

  it("puts the locale in the key without dropping the path or search", async () => {
    const renderer = createRenderer();

    expect(renderer.getPPRCacheKey("/dashboard", "?a=1", "fr")).not.toBe(
      renderer.getPPRCacheKey("/dashboard", "?a=1", "en"),
    );
    expect(renderer.getPPRCacheKey("/dashboard", "", "fr")).not.toBe(
      renderer.getPPRCacheKey("/other", "", "fr"),
    );
    expect(renderer.getPPRCacheKey("/dashboard", "?a=1", "fr")).not.toBe(
      renderer.getPPRCacheKey("/dashboard", "?a=2", "fr"),
    );
  });
});
