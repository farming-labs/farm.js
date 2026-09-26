import { describe, expect, it } from "vitest";
import {
  generateFarmDevIndicatorsClientRuntime,
  resolveFarmDevIndicatorsConfig,
} from "../dev-indicators";

describe("development build activity indicator", () => {
  it("resolves development defaults and configured positions", () => {
    expect(resolveFarmDevIndicatorsConfig(undefined, "development")).toEqual({
      buildActivity: true,
      buildActivityPosition: "bottom-right",
    });
    expect(
      resolveFarmDevIndicatorsConfig(
        { buildActivity: true, buildActivityPosition: "top-left" },
        "development",
      ),
    ).toEqual({
      buildActivity: true,
      buildActivityPosition: "top-left",
    });
  });

  it("emits a corner-aware, accessible HMR runtime", () => {
    const runtime = generateFarmDevIndicatorsClientRuntime({
      buildActivity: true,
      buildActivityPosition: "top-left",
    });

    expect(runtime).toContain("left: 16px; top: 16px;");
    expect(runtime).toContain('indicator.setAttribute("role", "status")');
    expect(runtime).toContain('hot.on("vite:beforeUpdate", onBeforeUpdate)');
    expect(runtime).toContain('hot.on("vite:afterUpdate", onAfterUpdate)');
    expect(runtime).toContain('hot.on("vite:error", onError)');
    expect(runtime).toContain('hot.on("vite:beforeFullReload", onBeforeFullReload)');
    expect(runtime).toContain('window.sessionStorage.setItem(reloadMarker, "1")');
    expect(runtime).toContain('brand.className = "farm-build-activity__brand"');
    expect(runtime).toContain('wordmark.append("FARM", suffix)');
    expect(runtime).toContain("indicator.append(loader, label, divider, brand, message)");
    expect(runtime).toContain("farm-build-activity-pixel-on 650ms ease-in-out infinite");
    expect(runtime).toContain('show("building", "Updating", "Farm.js updating")');
    expect(runtime).toContain("@media (prefers-reduced-motion: reduce)");
    expect(runtime).not.toContain("farm-build-activity-spin");
  });

  it("emits no client runtime when disabled or in production", () => {
    expect(resolveFarmDevIndicatorsConfig(undefined, "production").buildActivity).toBe(false);
    expect(
      generateFarmDevIndicatorsClientRuntime({
        buildActivity: false,
        buildActivityPosition: "bottom-right",
      }),
    ).toBe("");
  });
});
