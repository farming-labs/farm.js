import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startProgressRuntime } from "./client.js";
import type { ResolvedProgressOptions } from "./types.js";

const options: ResolvedProgressOptions = { delayMs: 150, color: "#2563eb", height: 3 };

function bar(): HTMLDivElement | null {
  return document.querySelector<HTMLDivElement>("[data-farm-progress]");
}

describe("startProgressRuntime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("shows no bar before the delay and a bar after it", () => {
    const runtime = startProgressRuntime(options, window);
    runtime.show();

    vi.advanceTimersByTime(149);
    expect(bar()).toBeNull();

    vi.advanceTimersByTime(1);
    const shown = bar();
    expect(shown).not.toBeNull();
    expect(shown?.style.width).toBe("8%");
    expect(shown?.style.opacity).toBe("1");
    expect(shown?.style.height).toBe("3px");
    expect(shown?.style.background).toBe("rgb(37, 99, 235)");
    expect(shown?.getAttribute("role")).toBe("progressbar");
  });

  it("trickles the bar toward 90% while the navigation is in flight", () => {
    const runtime = startProgressRuntime(options, window);
    runtime.show();
    vi.advanceTimersByTime(150);

    vi.advanceTimersByTime(200);
    expect(bar()?.style.width).toBe("16%");
    vi.advanceTimersByTime(200);
    expect(bar()?.style.width).toBe("24%");

    vi.advanceTimersByTime(200 * 20);
    expect(bar()?.style.width).toBe("90%");
  });

  it("completes and removes the bar when the navigation renders", () => {
    const runtime = startProgressRuntime(options, window);
    runtime.show();
    vi.advanceTimersByTime(150);
    expect(bar()).not.toBeNull();

    runtime.hide();
    expect(bar()?.style.width).toBe("100%");

    vi.advanceTimersByTime(199);
    expect(bar()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(bar()).toBeNull();
  });

  it("never flashes the bar when the navigation renders before the delay", () => {
    const runtime = startProgressRuntime(options, window);
    runtime.show();
    vi.advanceTimersByTime(100);
    runtime.hide();

    vi.advanceTimersByTime(1000);
    expect(bar()).toBeNull();
  });

  it("flashes the bar red when the navigation errors", () => {
    const runtime = startProgressRuntime(options, window);
    runtime.fail();

    const shown = bar();
    expect(shown).not.toBeNull();
    expect(shown?.style.width).toBe("100%");
    expect(shown?.style.background).toBe("rgb(220, 38, 38)");

    vi.advanceTimersByTime(299);
    expect(bar()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(bar()).toBeNull();
  });

  it("keeps the bar up when a second navigation starts before the first renders", () => {
    const runtime = startProgressRuntime(options, window);
    runtime.show();
    vi.advanceTimersByTime(150);
    expect(bar()?.style.width).toBe("8%");

    runtime.show();
    vi.advanceTimersByTime(150);
    expect(bar()).not.toBeNull();
    expect(bar()?.style.width).toBe("8%");
  });

  it("removes the bar on close and ignores later calls", () => {
    const runtime = startProgressRuntime(options, window);
    runtime.show();
    vi.advanceTimersByTime(150);
    expect(bar()).not.toBeNull();

    runtime.close();
    expect(bar()).toBeNull();

    runtime.show();
    vi.advanceTimersByTime(1000);
    expect(bar()).toBeNull();
  });

  it("uses custom color and height", () => {
    const runtime = startProgressRuntime({ delayMs: 0, color: "red", height: 5 }, window);
    runtime.show();
    vi.advanceTimersByTime(0);

    expect(bar()?.style.background).toBe("red");
    expect(bar()?.style.height).toBe("5px");
  });
});
