import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FarmI18nClientSnapshot } from "../i18n/types";

function snapshot(
  locale = "en",
  messages = { greeting: "Hello, {name}!" },
): FarmI18nClientSnapshot {
  return {
    locale,
    messages,
    locales: ["en", "fr", "ar"],
    defaultLocale: "en",
    source: "explicit",
    routing: "prefix-except-default",
    direction: locale === "ar" ? "rtl" : "ltr",
    cookie: { name: "farm_locale", path: "/", maxAge: 3600, sameSite: "lax", secure: false },
  };
}

beforeEach(() => {
  vi.resetModules();
  delete window.__FARM_I18N__;
});

afterEach(() => {
  delete window.__FARM_I18N__;
  document.documentElement.removeAttribute("lang");
  document.documentElement.removeAttribute("dir");
});

describe("lightweight client locale state", () => {
  it("keeps unconfigured links unchanged and reads the serialized snapshot before hydration", async () => {
    const state = await import("../i18n/client-state");
    expect(state.getFarmI18nClientState()).toBeUndefined();
    expect(state.localizeActiveFarmHref("/products?sort=name#top")).toBe("/products?sort=name#top");
    expect(state.isFarmLocaleChangeHref("/fr/products")).toBe(false);
    state._hydrateFarmI18n(undefined);
    expect(state.getFarmI18nClientState()).toBeUndefined();
    window.__FARM_I18N__ = snapshot("fr");
    expect(state.getFarmI18nClientState()).toBe(window.__FARM_I18N__);
    expect(state.localizeActiveFarmHref("/products?sort=name#top")).toBe(
      "/fr/products?sort=name#top",
    );
  });

  it("shares hydration with translation and clears the formatter cache before subscribers run", async () => {
    const state = await import("../i18n/client-state");
    // Register before loading translation: cache invalidation cannot depend on
    // which module's listener happens to have subscribed first.
    const sizes: number[] = [];
    const translations: string[] = [];
    const unsubscribe = state.subscribeFarmI18n(() => {
      sizes.push(state.compiledFarmI18nMessages.size);
      translations.push(runtime.t("greeting", { name: "Farm" }));
    });
    const runtime = await import("../i18n/client-runtime");
    const client = await import("../i18n/client");
    expect(runtime._hydrateFarmI18n).toBe(state._hydrateFarmI18n);
    expect(runtime.getFarmI18nClientState).toBe(state.getFarmI18nClientState);
    expect(runtime.subscribeFarmI18n).toBe(state.subscribeFarmI18n);

    client._setFarmI18nClientSnapshot(snapshot());
    const formatter = [...state.compiledFarmI18nMessages.values()][0];
    state._hydrateFarmI18n(snapshot());
    expect([...state.compiledFarmI18nMessages.values()][0]).toBe(formatter);
    state._hydrateFarmI18n(snapshot("fr", { greeting: "Bonjour, {name} !" }));
    expect(sizes).toEqual([0, 1, 0]);
    expect(translations).toEqual(["Hello, Farm!", "Hello, Farm!", "Bonjour, Farm !"]);
    expect(state.compiledFarmI18nMessages.size).toBe(1);
    expect(client.getLocale()).toBe("fr");

    unsubscribe();
    const arabic = snapshot("ar", { greeting: "مرحبا، {name}!" });
    state._hydrateFarmI18n(arabic);
    expect(window.__FARM_I18N__).toBe(arabic);
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(state.compiledFarmI18nMessages.size).toBe(0);
    expect(sizes).toHaveLength(3);
  });

  it("preserves plurals, rich output, changed messages, and missing-key behavior", async () => {
    const state = await import("../i18n/client-state");
    const { t } = await import("../i18n/client-runtime");
    expect(() => t("missing")).toThrow("not configured");
    state._hydrateFarmI18n({
      ...snapshot(),
      messages: {
        items: "{count, plural, one {# item} other {# items}}",
        rich: "Read <b>this</b>",
      },
    });
    expect(t("items", { count: 1 })).toBe("1 item");
    expect(t("items", { count: 3 })).toBe("3 items");
    const rich = (chunks: unknown[]) => ({ type: "strong", children: chunks });
    expect(t.rich("rich", { b: rich })).toEqual(["Read ", { type: "strong", children: ["this"] }]);
    expect(() => t("rich", { b: rich })).toThrow("t.rich()");
    for (const key of ["missing", "toString", "constructor"]) {
      expect(t(key)).toBe(key);
      expect(t.raw(key)).toBe(key);
      expect(t.has(key)).toBe(false);
    }
    state._hydrateFarmI18n({ ...snapshot(), messages: { items: "Changed {count}" } });
    expect(t("items", { count: 3 })).toBe("Changed 3");
  });
});
