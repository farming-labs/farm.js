// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("development diagnostics loading", () => {
  let loading: ReturnType<typeof deferred>;
  let requested: ReturnType<typeof deferred>;
  const overlay = { show: vi.fn(), dismiss: vi.fn(), destroy: vi.fn() };
  const createOverlay = vi.fn(() => overlay);
  const managers: Array<{ close(): Promise<void> }> = [];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    loading = deferred();
    requested = deferred();
    vi.doMock("@farm.js/core/internal/client-error-overlay", async () => {
      requested.resolve();
      await loading.promise;
      return { createFarmRuntimeErrorOverlay: createOverlay };
    });
  });

  afterEach(async () => {
    loading.resolve();
    await Promise.all(managers.splice(0).map((manager) => manager.close()));
    vi.doUnmock("@farm.js/core/internal/client-error-overlay");
    vi.restoreAllMocks();
  });

  async function createManager(setup = vi.fn(), error = vi.fn(), isDev = true) {
    const { createClientPluginManager } = await import("../client/plugin");
    const manager = createClientPluginManager(
      [{ name: "test:diagnostics", definition: { setup, error } }],
      { router: { async navigate() {} }, isDev, window },
    );
    managers.push(manager);
    return manager;
  }

  it("waits for diagnostics before setup and preserves errors reported during loading", async () => {
    const setup = vi.fn();
    const error = vi.fn();
    const manager = await createManager(setup, error);
    const started = manager.start();
    await requested.promise;
    const failure = new Error("early client error");
    const reported = manager.reportError(failure, "window");
    expect(setup).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    loading.resolve();
    await Promise.all([started, reported]);
    expect(setup).toHaveBeenCalledOnce();
    expect(createOverlay).toHaveBeenCalledOnce();
    expect(overlay.show).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ phase: "window" }),
    );
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ error: failure }));
    await manager.close();
  });

  it("destroys diagnostics exactly once when closed while loading", async () => {
    const manager = await createManager();
    const started = manager.start();
    await requested.promise;
    const closed = manager.close();
    loading.resolve();
    await Promise.all([started, closed]);
    await manager.close();
    await manager.reportError(new Error("after close"), "window");
    expect(overlay.destroy).toHaveBeenCalledOnce();
    expect(overlay.show).not.toHaveBeenCalled();
  });

  it("allows setup hooks to await error reporting without awaiting their own startup", async () => {
    const failure = new Error("setup diagnostic");
    const setup = vi.fn(async () => {
      await manager.reportError(failure, "setup");
    });
    const manager = await createManager(setup);
    const started = manager.start();
    await requested.promise;
    loading.resolve();
    await started;

    expect(setup).toHaveBeenCalledOnce();
    expect(overlay.show).toHaveBeenCalledWith(failure, expect.objectContaining({ phase: "setup" }));
  });

  it("continues application startup and error hooks when the diagnostics import fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const setup = vi.fn();
    const error = vi.fn();
    const manager = await createManager(setup, error);
    const started = manager.start();
    await requested.promise;
    const failure = new Error("diagnostics chunk unavailable");
    loading.reject(failure);
    await started;
    expect(setup).toHaveBeenCalledOnce();
    // Vitest wraps a rejected dynamic mock import with the original error as
    // its cause; the runtime must preserve that diagnostic rather than hide it.
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("farm:runtime-error-overlay"),
      expect.objectContaining({ cause: failure }),
    );
    const browserError = new Error("application still reports errors");
    window.dispatchEvent(new ErrorEvent("error", { error: browserError }));
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(expect.objectContaining({ error: browserError })),
    );
    expect(createOverlay).not.toHaveBeenCalled();
    await manager.close();
  });

  it("does not request diagnostics for production managers", async () => {
    const manager = await createManager(vi.fn(), vi.fn(), false);
    await manager.start();
    expect(createOverlay).not.toHaveBeenCalled();
    await manager.close();
  });
});
