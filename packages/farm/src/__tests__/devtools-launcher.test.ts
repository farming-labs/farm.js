import { afterEach, describe, expect, it, vi } from "vitest";
import { generateFarmDevtoolsClientRuntime } from "../devtools-client";

const win = window as Window &
  typeof globalThis & {
    __FARM_DEVTOOLS_RUNTIME__?: { dispose(): void };
    __FARM_DEVTOOLS__?: { open(): void };
  };
afterEach(() => {
  win.__FARM_DEVTOOLS_RUNTIME__?.dispose();
  delete win.__FARM_DEVTOOLS_RUNTIME__;
  delete win.__FARM_DEVTOOLS__;
  document.body.innerHTML = "";
  document.getElementById("__farm_devtools_overlay_styles__")?.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup(shortcut: string | false = false) {
  vi.useFakeTimers();
  document.body.innerHTML = "<main>App</main>";
  vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
  const frame = (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  };
  const install = () => {
    new Function(
      "requestAnimationFrame",
      generateFarmDevtoolsClientRuntime({ enabled: true, shortcut }),
    )(frame);
    win.document.dispatchEvent(new win.Event("DOMContentLoaded"));
  };
  install();
  const button = () =>
    win.document.getElementById("__farm_devtools_launcher__")?.shadowRoot?.querySelector("button");
  return { win, install, button };
}

describe("DevTools on-page launcher", () => {
  it("uses a Hints-style isolated pill and an accessible native button", () => {
    const { button } = setup();
    expect(button()).toBeTruthy();
    expect(button()?.textContent).toContain("DevTools");
    expect(button()?.getAttribute("type")).toBe("button");
    expect(button()?.getAttribute("aria-label")).toBe("Open Farm DevTools");
    expect(button()?.getAttribute("aria-haspopup")).toBe("dialog");
    const styles = (button()?.getRootNode() as ShadowRoot)?.querySelector("style")?.textContent;
    expect(styles).toContain("min-height: 42px");
    expect(styles).toContain("Geist Mono");
    expect(styles).toContain(":focus-visible");
  });

  it("opens without a shortcut and returns keyboard focus to the trigger", async () => {
    const { win, button } = setup();
    const trigger = button()!;
    expect(trigger).toBeTruthy();
    trigger.focus();
    trigger.click();
    expect(win.document.querySelector("iframe")?.getAttribute("src")).toBe(
      "/__farm/devtools?embedded=1",
    );
    win.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape" }));
    // Repeated close signals must not discard the original trigger focus.
    win.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape" }));
    await vi.advanceTimersByTimeAsync(200);
    expect(win.document.querySelector("iframe")).toBeNull();
    expect((trigger.getRootNode() as ShadowRoot).activeElement).toBe(trigger);
    trigger.click();
    expect(win.document.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("keeps one working launcher after runtime reinjection", () => {
    const { win, install, button } = setup();
    install();
    expect(win.document.querySelectorAll("#__farm_devtools_launcher__")).toHaveLength(1);
    button()!.click();
    expect(win.document.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("disposes the launcher and a pending DOM-ready attachment", () => {
    const { win, button } = setup();
    expect(button()).toBeTruthy();
    win.__FARM_DEVTOOLS_RUNTIME__!.dispose();
    expect(button()).toBeUndefined();
    win.__FARM_DEVTOOLS__!.open();
    expect(win.document.querySelector("iframe")).toBeNull();
    new Function(generateFarmDevtoolsClientRuntime({ enabled: true, shortcut: false }))();
    win.__FARM_DEVTOOLS_RUNTIME__!.dispose();
    win.document.dispatchEvent(new win.Event("DOMContentLoaded"));
    expect(button()).toBeUndefined();
  });
});
