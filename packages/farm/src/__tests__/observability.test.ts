import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureFarmObservability,
  emitFarmEvent,
  onFarmEvent,
  resetFarmObservability,
  type FarmEvent,
} from "../observability";

describe("observability", () => {
  afterEach(() => {
    resetFarmObservability();
    vi.restoreAllMocks();
  });

  it("emits events to config and runtime handlers", () => {
    const configEvents: FarmEvent[] = [];
    const runtimeEvents: FarmEvent[] = [];

    configureFarmObservability({ onEvent: (event) => configEvents.push(event) });
    const unsubscribe = onFarmEvent((event) => runtimeEvents.push(event));

    emitFarmEvent({ type: "cache.hit", key: "product:1" });
    unsubscribe();
    emitFarmEvent({ type: "cache.miss", key: "product:2" });

    expect(configEvents.map((event) => event.type)).toEqual(["cache.hit", "cache.miss"]);
    expect(runtimeEvents.map((event) => event.type)).toEqual(["cache.hit"]);
  });

  it("filters events when event types are configured", () => {
    const events: FarmEvent[] = [];

    configureFarmObservability({
      events: ["ppr.shell.cached"],
      onEvent: (event) => events.push(event),
    });

    emitFarmEvent({ type: "cache.hit", key: "ignored" });
    emitFarmEvent({ type: "ppr.shell.cached", route: "/dashboard", key: "ppr:dashboard" });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "ppr.shell.cached",
      route: "/dashboard",
      level: "info",
    });
  });

  it("writes compact logs when observability logs are enabled", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    configureFarmObservability({ logs: true });
    emitFarmEvent({
      type: "render.complete",
      route: "/dashboard",
      pathname: "/dashboard",
      status: 200,
      durationMs: 12,
    });

    expect(log).toHaveBeenCalledWith(
      "[farm:info] render.complete route=/dashboard pathname=/dashboard status=200 durationMs=12",
    );
  });
});
