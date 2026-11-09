// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createClientPluginManager } from "../client/plugin";
import { createPluginlessClientRuntime } from "../client/pluginless-runtime";

const router = {} as never;
const input = { to: "http://localhost/next", action: "push" } as never;

// With no plugins, the small runtime must behave as the full manager does.
describe.each([
  ["plugin manager", () => createClientPluginManager([], { router, window })],
  ["pluginless runtime", () => createPluginlessClientRuntime()],
])("navigation sessions: %s", (_name, create) => {
  it("aborts the previous navigation when a new one begins", async () => {
    const runtime = create();
    const first = await runtime.beginNavigation(input);
    const second = await runtime.beginNavigation(input);
    expect(first.signal.aborted).toBe(true);
    expect(first.signal.reason).toBe("superseded");
    expect(second.signal.aborted).toBe(false);
  });

  it("cancels only the current navigation", async () => {
    const runtime = create();
    const first = await runtime.beginNavigation(input);
    const second = await runtime.beginNavigation(input);
    runtime.cancelNavigation(first, "late");
    expect(second.signal.aborted).toBe(false);
    runtime.cancelNavigation(second, "stop");
    expect(second.signal.reason).toBe("stop");
  });

  it("finishes a navigation after two frames, so a later cancel leaves it alone", async () => {
    const frames = vi.spyOn(window, "requestAnimationFrame");
    const runtime = create();
    const session = await runtime.beginNavigation(input);
    await runtime.scheduleNavigationRendered(session);
    expect(frames.mock.calls.length).toBeGreaterThanOrEqual(2);
    frames.mockRestore();
    runtime.cancelNavigation();
    expect(session.signal.aborted).toBe(false);
  });

  it("forgets a failed navigation", async () => {
    const runtime = create();
    const session = await runtime.beginNavigation(input);
    await runtime.failNavigation(session, new Error("failed"));
    runtime.cancelNavigation();
    expect(session.signal.aborted).toBe(false);
  });
});
