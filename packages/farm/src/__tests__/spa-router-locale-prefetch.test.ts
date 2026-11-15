// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPARouter } from "../client/spa-router";
import { _hydrateFarmI18n, isFarmLocaleChangeHref } from "../i18n/client-runtime";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("relative locale prefetch", () => {
  for (const basePath of ["", "/store"]) {
    for (const routing of ["prefix-always", "prefix-except-default"] as const) {
      it(`resolves relative links at ${basePath || "/"} with ${routing}`, async () => {
        window.history.replaceState(null, "", `${basePath}/fr/products/details`);
        _hydrateFarmI18n({
          locale: "fr",
          source: "explicit",
          locales: ["en", "fr"],
          defaultLocale: "en",
          routing,
          basePath,
          direction: "ltr",
          messages: {},
          cookie: { name: "farm-locale", maxAge: 3600, path: "/", sameSite: "lax", secure: false },
        });
        const fetch = vi.fn(async () => Response.json({ props: {}, modulePath: "/page.js" }));
        vi.stubGlobal("fetch", fetch);
        const router = new SPARouter({ scrollRestoration: false });
        try {
          for (const href of ["?tab=2", "next", "../related"]) {
            expect(isFarmLocaleChangeHref(href)).toBe(false);
            const target = new URL(href, window.location.href);
            await router.prefetch(href);
            expect(fetch).toHaveBeenLastCalledWith(
              `/__farm/page-data?path=${encodeURIComponent(target.pathname + target.search)}`,
              expect.any(Object),
            );
          }
          expect(fetch).toHaveBeenCalledTimes(3);
          expect(isFarmLocaleChangeHref(`${basePath}/en/products`)).toBe(true);
          await router.prefetch(`${basePath}/en/products`);
          await router.prefetch("https://outside.test/fr/products");
          expect(fetch).toHaveBeenCalledTimes(3);
        } finally {
          router.destroy();
        }
      });
    }
  }
});
