// @vitest-environment node

import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { createPPRRefreshScript } from "../server/renderer";

describe("PPR refresh script", () => {
  it("bypasses HTTP caches when it requests the completed page", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false });

    new JSDOM(`<!doctype html>${createPPRRefreshScript()}`, {
      runScripts: "dangerously",
      url: "https://example.test/dashboard",
      beforeParse(window) {
        Object.defineProperty(window, "fetch", { value: fetch });
      },
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

    expect(fetch).toHaveBeenCalledWith("https://example.test/dashboard", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "x-farm-ppr-refresh": "1" },
    });
  });
});
