// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { attachRevalidationListeners } from "../client-revalidation";

describe("shared revalidation listeners", () => {
  it("refreshes on window focus and online by default", () => {
    const refresh = vi.fn();
    const dispose = attachRevalidationListeners(refresh);

    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));

    expect(refresh).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("honors the focus opt-out without touching reconnect", () => {
    const refresh = vi.fn();
    const dispose = attachRevalidationListeners(refresh, { refetchOnWindowFocus: false });

    window.dispatchEvent(new Event("focus"));
    expect(refresh).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("online"));
    expect(refresh).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("honors the reconnect opt-out without touching focus", () => {
    const refresh = vi.fn();
    const dispose = attachRevalidationListeners(refresh, { refetchOnReconnect: false });

    window.dispatchEvent(new Event("online"));
    expect(refresh).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("detaches both listeners on dispose", () => {
    const refresh = vi.fn();
    const dispose = attachRevalidationListeners(refresh);
    dispose();

    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));

    expect(refresh).not.toHaveBeenCalled();
  });

  it("repeated dispose does not remove a newer subscriber's listeners", () => {
    const first = vi.fn();
    const second = vi.fn();
    const disposeFirst = attachRevalidationListeners(first);
    disposeFirst();

    const disposeSecond = attachRevalidationListeners(second);
    disposeFirst();

    window.dispatchEvent(new Event("focus"));
    expect(second).toHaveBeenCalledTimes(1);
    disposeSecond();
  });
});
