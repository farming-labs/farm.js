// @vitest-environment node

import { describe, expect, it } from "vitest";
import { solid } from "../index";
import { createElement, generateHydrationScript, renderToString } from "../server";

describe("Solid renderer", () => {
  it("returns an isolated renderer descriptor", () => {
    const first = solid();
    const second = solid();

    expect(first).toMatchObject({
      name: "solid",
      vite: "@farm.js/solid/vite",
      server: "@farm.js/solid/server",
      client: "@farm.js/solid/client",
      jsxImportSource: "solid-js",
      capabilities: { streaming: { node: false, web: false } },
    });
    expect(first.dedupe).not.toBe(second.dedupe);
    expect(first.optimizeDeps).not.toBe(second.optimizeDeps);
  });

  it("renders FARMJS elements with Solid's server runtime", async () => {
    const html = await renderToString(
      createElement(
        "main",
        { className: "solid-app" },
        createElement("h1", null, "Hello from Solid"),
      ),
    );

    expect(html).toMatch(/<main[^>]+class="solid-app\s*"/);
    expect(html).toContain("Hello from Solid");
    expect(html).toContain("data-hk=");
  });

  it("provides Solid's hydration bootstrap for server documents", () => {
    expect(generateHydrationScript()).toContain("window._$HY");
  });
});
