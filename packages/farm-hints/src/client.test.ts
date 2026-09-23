import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHintsRuntime } from "./client.js";
import { resolveHintsOptions } from "./config.js";

const mocks = vi.hoisted(() => ({
  onCLS: vi.fn(),
  onINP: vi.fn(),
  onLCP: vi.fn(),
  collectDocumentHints: vi.fn(),
}));

vi.mock("web-vitals", () => ({
  onCLS: mocks.onCLS,
  onINP: mocks.onINP,
  onLCP: mocks.onLCP,
}));

vi.mock("./scan.js", () => ({
  collectDocumentHints: mocks.collectDocumentHints,
}));

describe("Farm Hints browser runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.lang = "en";
    document.body.innerHTML = "<main></main>";
    mocks.collectDocumentHints.mockResolvedValue([
      {
        id: "html:duplicate-id:demo",
        category: "html",
        severity: "serious",
        title: "Duplicate id",
        detail: "Use a unique id.",
      },
    ]);
    vi.spyOn(console, "groupCollapsed").mockImplementation(() => undefined);
    vi.spyOn(console, "groupEnd").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports scans and Farm timings without holding up rendering hooks", async () => {
    const runtime = startHintsRuntime(
      resolveHintsOptions({
        accessibility: false,
        html: true,
        thirdParty: false,
        report: "console",
      }),
      window,
    );

    await runtime.scan("test", "/settings");
    expect(console.groupCollapsed).toHaveBeenCalledWith("[Farm Hints] 1 hint on /settings");
    expect(console.warn).toHaveBeenCalledWith("[html] Duplicate id", "", "Use a unique id.");

    runtime.recordTiming("hydration", 700, "/settings");
    expect(console.warn).toHaveBeenCalledWith(
      "[performance] Hydration took 700 ms",
      "",
      expect.stringContaining("500 ms"),
    );

    runtime.close();
  });

  it("connects the three browser vitals only when performance hints are enabled", () => {
    const runtime = startHintsRuntime(
      resolveHintsOptions({
        accessibility: false,
        html: false,
        thirdParty: false,
        report: "console",
      }),
      window,
    );
    expect(mocks.onLCP).toHaveBeenCalledOnce();
    expect(mocks.onCLS).toHaveBeenCalledOnce();
    expect(mocks.onINP).toHaveBeenCalledOnce();
    runtime.close();
  });

  it("preserves every scan finding whose id is unique across the frame chain (iframe fix)", async () => {
    mocks.collectDocumentHints.mockResolvedValue([
      {
        id: "accessibility:button-name:#frame#0",
        category: "accessibility",
        severity: "critical",
        title: "First button",
        detail: "Add text.",
        selector: "#frame",
      },
      {
        id: "accessibility:button-name:#frame#1",
        category: "accessibility",
        severity: "critical",
        title: "Second button",
        detail: "Add text.",
        selector: "#frame",
      },
    ]);

    const runtime = startHintsRuntime(
      resolveHintsOptions({
        accessibility: false,
        html: false,
        thirdParty: false,
        report: "console",
      }),
      window,
    );
    await runtime.scan("test", "/iframe");

    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith(
      "[accessibility] First button",
      "#frame",
      "Add text.",
    );
    expect(console.warn).toHaveBeenCalledWith(
      "[accessibility] Second button",
      "#frame",
      "Add text.",
    );
    runtime.close();
  });
});
