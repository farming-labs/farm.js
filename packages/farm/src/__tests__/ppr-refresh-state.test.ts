// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { createPPRRefreshScript } from "../server/renderer";

describe("PPR refresh state", () => {
  it("applies refreshed bootstrap state before completing the refresh", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `<!doctype html>
        <html><head>
          <script data-farm-refresh-state>
            window.__FARM_PROPS__ = { value: "fresh" };
          </script>
          <script data-farm-refresh-state>
            window.__FARM_DEFERRED_DATA__ = { d0: { status: "resolved", value: "fresh" } };
          </script>
        </head><body><div id="root">fresh</div></body></html>`,
    });
    const dom = new JSDOM(`<!doctype html><div id="root">stale</div>${createPPRRefreshScript()}`, {
      runScripts: "dangerously",
      url: "https://example.test/dashboard",
      beforeParse(window) {
        Object.defineProperty(window, "fetch", { value: fetch });
        Object.assign(window, {
          __FARM_PROPS__: { value: "stale" },
          __FARM_DEFERRED_DATA__: { d0: { status: "resolved", value: "stale" } },
        });
      },
    });

    await (dom.window as any).__FARM_PPR_REFRESH_PROMISE__;

    expect((dom.window as any).__FARM_PROPS__).toEqual({ value: "fresh" });
    expect((dom.window as any).__FARM_DEFERRED_DATA__).toEqual({
      d0: { status: "resolved", value: "fresh" },
    });
    expect(dom.window.document.getElementById("root")?.textContent).toBe("fresh");
  });

  it("makes development and production hydration wait for refreshed state", () => {
    const sources = [
      fs.readFileSync(path.join(process.cwd(), "src", "vite.ts"), "utf8"),
      fs.readFileSync(path.join(process.cwd(), "src", "nitro", "universal-build.ts"), "utf8"),
    ];

    for (const source of sources) {
      expect(source).toMatch(
        /async function hydrate\(\) \{\s+await window\.__FARM_PPR_REFRESH_PROMISE__;/,
      );
    }
  });
});
