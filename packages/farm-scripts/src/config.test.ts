import { beforeEach, describe, expect, it } from "vitest";
import { defineScript } from "./client.js";
import { resolveScriptsOptions } from "./config.js";

describe("resolveScriptsOptions", () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, Symbol.for("@farm.js/scripts.browser-store"));
  });

  it("normalizes concise definitions into browser-safe configuration", () => {
    const analytics = defineScript({
      name: "analytics",
      src: "https://cdn.example.test/analytics.js",
      global: "vendor.analytics",
      timeout: "20s",
      retryDelay: "1.5s",
      retries: 2,
      preconnect: true,
      attributes: { "data-site": "farm", "data-debug": false },
    });

    expect(resolveScriptsOptions({ scripts: [analytics] })).toEqual({
      basePath: "/",
      scripts: [
        {
          name: "analytics",
          src: "https://cdn.example.test/analytics.js",
          global: "vendor.analytics",
          load: "after-hydration",
          dependsOn: [],
          type: "classic",
          placement: "head",
          async: true,
          timeoutMs: 20_000,
          readyTimeoutMs: 1_000,
          retries: 2,
          retryDelayMs: 1_500,
          preconnect: true,
          attributes: { "data-site": "farm", "data-debug": "false" },
        },
      ],
    });
  });

  it("supports handles as dependencies and normalizes visible loading", () => {
    const maps = defineScript({ name: "maps", src: "/vendor/maps.js", load: "manual" });
    const places = defineScript({
      name: "places",
      src: "/vendor/places.js",
      dependsOn: [maps, "maps"],
      load: { when: "visible", selector: "[data-map]" },
    });

    expect(resolveScriptsOptions({ scripts: [maps, places] }).scripts[1]).toMatchObject({
      dependsOn: ["maps"],
      load: { when: "visible", selector: "[data-map]", rootMargin: "200px" },
    });
  });

  it("rejects ambiguous or unsafe definitions", () => {
    expect(() => defineScript({ name: "x", src: "./vendor.js" })).toThrow("root-relative");
    expect(() => defineScript({ name: "x", src: "/\\evil.example/vendor.js" })).toThrow(
      "backslashes",
    );
    expect(() => defineScript({ name: "x", src: "/vendor/unsafe\nscript.js" })).toThrow(
      "control characters",
    );
    for (const [index, src] of [
      "/%2e%2e/vendor.js",
      "/vendor/%2Fscript.js",
      "/vendor/%5cscript.js",
      "/vendor/%00script.js",
    ].entries()) {
      expect(() => defineScript({ name: `unstable-${index}`, src })).toThrow("browser-unstable");
    }
    expect(() =>
      defineScript({ name: "x", src: "/vendor.js", global: "window.__proto__.x" }),
    ).toThrow("relative to window");
    expect(() =>
      defineScript({ name: "x", src: "https://user:password@cdn.example.test/vendor.js" }),
    ).toThrow("URL credentials");
    expect(() =>
      defineScript({ name: "x", src: "/vendor.js", attributes: { src: "other" } as never }),
    ).toThrow("data-* attribute");
    expect(() =>
      defineScript({
        name: "x",
        src: "/vendor.js",
        attributes: { "data-farm-script": "other" },
      }),
    ).toThrow("reserved");
    expect(() =>
      defineScript({ name: "x", src: "/vendor.js", timeout: "tomorrow" as never }),
    ).toThrow("duration");
    expect(() =>
      defineScript({
        name: "x",
        src: "/vendor.js",
        load: { when: "visible", selector: "" },
      }),
    ).toThrow("non-empty string");
  });

  it("rejects duplicate names, sources, missing dependencies, and cycles", () => {
    const first = defineScript({ name: "first", src: "/first.js" });
    const duplicateSource = defineScript({ name: "second", src: "/first.js" });
    const missing = defineScript({ name: "missing", src: "/missing.js", dependsOn: ["nope"] });
    const cycleA = defineScript({ name: "a", src: "/a.js", dependsOn: ["b"] });
    const cycleB = defineScript({ name: "b", src: "/b.js", dependsOn: ["a"] });

    expect(() => resolveScriptsOptions({ scripts: [first, first] })).toThrow("duplicate name");
    expect(() => defineScript({ name: "first", src: "/different.js" })).toThrow(
      "conflicting options",
    );
    expect(() => resolveScriptsOptions({ scripts: [first, duplicateSource] })).toThrow("same src");
    expect(() => resolveScriptsOptions({ scripts: [missing] })).toThrow("unregistered script");
    expect(() => resolveScriptsOptions({ scripts: [cycleA, cycleB] })).toThrow("a -> b -> a");
  });

  it("does not add a redundant enabled option", () => {
    const script = defineScript({ name: "demo", src: "/demo.js" });
    expect(() => resolveScriptsOptions({ scripts: [script], enabled: false } as never)).toThrow(
      "does not accept enabled",
    );
  });
});
