import { beforeEach, describe, expect, it, vi } from "vitest";
import { startMswBrowserRuntime } from "./client.js";

const mocks = vi.hoisted(() => ({
  start: vi.fn(async () => undefined),
  stop: vi.fn(),
  setupWorker: vi.fn(),
}));

vi.mock("msw/browser", () => ({
  setupWorker: mocks.setupWorker,
}));

describe("MSW browser runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setupWorker.mockReturnValue({ start: mocks.start, stop: mocks.stop });
  });

  it("starts the worker with Farm's base path and unhandled-request policy", async () => {
    const runtime = await startMswBrowserRuntime({
      workerUrl: "/shop/mockServiceWorker.js",
      scope: "/shop/",
      onUnhandledRequest: "warn",
    });

    expect(mocks.setupWorker).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledWith({
      onUnhandledRequest: "warn",
      serviceWorker: {
        url: "/shop/mockServiceWorker.js",
        options: { scope: "/shop/" },
      },
    });

    runtime.stop();
    runtime.stop();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });
});
