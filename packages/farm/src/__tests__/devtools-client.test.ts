import { describe, expect, it } from "vitest";
import { generateFarmDevtoolsClientRuntime } from "../devtools-client";

describe("Farm DevTools client runtime", () => {
  it("installs the default shortcut-driven overlay", () => {
    const runtime = generateFarmDevtoolsClientRuntime({
      enabled: true,
      shortcut: "mod+shift+.",
    });

    expect(runtime).toContain('frame.src = "/__farm/devtools?embedded=1"');
    expect(runtime).toContain(
      "window.__FARM_DEVTOOLS__ = { open, close, toggle }",
    );
    expect(runtime).toContain('"key":"."');
    expect(runtime).toContain('event.code === "Period"');
  });

  it("keeps the programmatic launcher without a keyboard shortcut", () => {
    const runtime = generateFarmDevtoolsClientRuntime({
      enabled: true,
      shortcut: false,
    });

    expect(runtime).toContain(
      "window.__FARM_DEVTOOLS__ = { open, close, toggle }",
    );
    expect(runtime).toContain("const shortcut = null");
  });

  it("omits the launcher when DevTools are disabled", () => {
    expect(
      generateFarmDevtoolsClientRuntime({ enabled: false, shortcut: false }),
    ).toBe("");
  });
});
