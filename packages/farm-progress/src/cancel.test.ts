import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startProgressRuntime } from "./client.js";
import { progress } from "./index.js";

function bar(): HTMLDivElement | null {
  return document.querySelector<HTMLDivElement>("[data-farm-progress]");
}

describe("progress plugin with canceled navigations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function setup() {
    const plugin = progress();
    const state = startProgressRuntime(plugin.client!.public!, window);
    const before = (signal: AbortSignal) =>
      (plugin.client!.navigation!.before as Function)({ state, signal });
    return { state, before };
  }

  it("removes the bar when core cancels the navigation without starting another", () => {
    const { before } = setup();
    const navigation = new AbortController();
    before(navigation.signal);
    vi.advanceTimersByTime(600);
    expect(bar()).not.toBeNull();

    // A hash link or a link to the current page aborts the session; no rendered or error follows.
    navigation.abort("superseded");
    vi.advanceTimersByTime(1000);
    expect(bar()).toBeNull();
  });

  it("keeps the bar up when a new navigation supersedes the canceled one", () => {
    const { before } = setup();
    const first = new AbortController();
    before(first.signal);
    vi.advanceTimersByTime(600);

    first.abort("superseded");
    before(new AbortController().signal);
    vi.advanceTimersByTime(1000);
    expect(bar()).not.toBeNull();
  });
});
