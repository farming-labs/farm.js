import { afterEach, describe, expect, it, vi } from "vitest";
import { createHintsOverlay } from "./overlay.js";

describe("Farm Hints overlay", () => {
  afterEach(() => {
    document.querySelector("farm-hints")?.remove();
  });

  it("opens for findings, filters groups, and keeps uppercase labels tightly tracked", () => {
    const onRescan = vi.fn();
    const overlay = createHintsOverlay({
      window,
      position: "bottom-right",
      open: "issues",
      onRescan,
    });
    overlay.update({
      pathname: "/checkout",
      scanning: false,
      metrics: [{ id: "LCP", value: 1_220, unit: "ms", status: "good" }],
      issues: [
        {
          id: "accessibility:button-name:#buy",
          category: "accessibility",
          severity: "serious",
          title: "Button has no accessible name",
          detail: "Add visible text or an aria-label.",
          selector: "#buy",
        },
      ],
    });

    const shadow = document.querySelector("farm-hints")?.shadowRoot;
    expect(shadow?.querySelector<HTMLElement>(".panel")?.hidden).toBe(false);
    expect(shadow?.querySelector("[data-route]")?.textContent).toBe("/checkout");
    expect(shadow?.querySelector(".issue-copy strong")?.textContent).toContain("accessible name");
    expect(shadow?.querySelector("style")?.textContent).toContain('"Geist Mono Variable"');
    expect(shadow?.querySelector("style")?.textContent).toContain("letter-spacing: 0");

    shadow?.querySelector<HTMLButtonElement>("[data-filter=performance]")?.click();
    expect(shadow?.querySelector("[data-empty]")?.textContent).toBe("No hints in this group.");

    shadow?.querySelector<HTMLButtonElement>("[data-action=rescan]")?.click();
    expect(onRescan).toHaveBeenCalledOnce();
    overlay.destroy();
    expect(document.querySelector("farm-hints")).toBeNull();
  });

  it("stays collapsed after a clean scan when configured to open for issues", () => {
    const overlay = createHintsOverlay({
      window,
      position: "bottom-right",
      open: "issues",
      onRescan: vi.fn(),
    });
    overlay.update({ pathname: "/", scanning: false, metrics: [], issues: [] });

    const shadow = document.querySelector("farm-hints")?.shadowRoot;
    expect(shadow?.querySelector<HTMLElement>(".panel")?.hidden).toBe(true);
    expect(shadow?.querySelector<HTMLButtonElement>(".launcher")?.hidden).toBe(false);
    overlay.destroy();
  });
});
