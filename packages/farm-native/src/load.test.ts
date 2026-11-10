import { afterEach, describe, expect, it, vi } from "vitest";
import { loadFarmScreen } from "./load";

type Handler = (error: unknown, isFatal?: boolean) => void;

/** React Native's `ErrorUtils` and Metro's guarded `require`, which report instead of throwing. */
function installErrorUtils(handler: Handler) {
  let current = handler;
  const errorUtils = {
    getGlobalHandler: () => current,
    setGlobalHandler: (next: Handler) => {
      current = next;
    },
  };
  (globalThis as { ErrorUtils?: unknown }).ErrorUtils = errorUtils;
  const metroRequire = (factory: () => object) => () => {
    try {
      return factory();
    } catch (error) {
      current(error, true);
      return undefined;
    }
  };
  return { errorUtils, metroRequire };
}

afterEach(() => {
  delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
});

describe("loadFarmScreen", () => {
  it("names the module and the original error when Metro reports it as fatal", () => {
    const fatal = vi.fn<Handler>();
    const { errorUtils, metroRequire } = installErrorUtils(fatal);
    const load = metroRequire(() => {
      throw new ReferenceError("stations is not defined");
    });

    let thrown: unknown;
    try {
      loadFarmScreen("app/map", load);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      "app/map failed to load: ReferenceError: stations is not defined",
    );
    expect((thrown as Error).cause).toBeInstanceOf(ReferenceError);
    // Still reported, so dev shows React Native's error screen, and the handler is restored.
    expect(fatal).toHaveBeenCalledOnce();
    expect(fatal.mock.calls[0]?.[1]).toBe(true);
    expect(errorUtils.getGlobalHandler()).toBe(fatal);
  });

  it("names the module when the require throws", () => {
    expect(() =>
      loadFarmScreen("app/camera", () => {
        throw new Error("boom");
      }),
    ).toThrow("app/camera failed to load: Error: boom");
  });

  it("names the module when it evaluates to nothing", () => {
    expect(() => loadFarmScreen("app/map", () => undefined)).toThrow(
      "app/map failed to load: its module evaluated to undefined.",
    );
  });

  it("returns the module and leaves the handler alone when it loads", () => {
    const handler = vi.fn<Handler>();
    const { errorUtils, metroRequire } = installErrorUtils(handler);
    const screen = { default: () => null };
    expect(
      loadFarmScreen(
        "app/map",
        metroRequire(() => screen),
      ),
    ).toBe(screen);
    expect(handler).not.toHaveBeenCalled();
    expect(errorUtils.getGlobalHandler()).toBe(handler);
  });
});
