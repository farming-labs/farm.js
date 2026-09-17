// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMutation, type UseMutationReturn } from "../mutation-client";
import { useFetcher, type UseFetcherReturn } from "../fetcher-client";

let root: ReturnType<typeof createRoot>;
let online = true;

function goOffline() {
  online = false;
}
async function goOnline() {
  online = true;
  window.dispatchEvent(new Event("online"));
  await Promise.resolve();
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  online = true;
  vi.spyOn(window.navigator, "onLine", "get").mockImplementation(() => online);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

describe("offline-paused mutations", () => {
  it("pauses an offline submission and resumes it on reconnect", async () => {
    const target = vi.fn(async (value: string) => `saved:${value}`);
    let mutation!: UseMutationReturn<typeof target>;
    function View() {
      mutation = useMutation(target, { networkMode: "online" });
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));

    goOffline();
    let settled: Promise<string>;
    await act(async () => {
      settled = mutation.mutateAsync("draft");
      await Promise.resolve();
    });

    expect(target).not.toHaveBeenCalled();
    expect(mutation.paused).toBe(true);
    expect(mutation.pending).toBe(true);
    expect(mutation.status).toBe("pending");

    await act(async () => {
      await goOnline();
      await expect(settled).resolves.toBe("saved:draft");
    });

    expect(target).toHaveBeenCalledTimes(1);
    expect(mutation.paused).toBe(false);
    expect(mutation.status).toBe("success");
    expect(mutation.data).toBe("saved:draft");
  });

  it("keeps the default dispatch-anyway behavior without the option", async () => {
    const target = vi.fn(async () => {
      throw new Error("network down");
    });
    let mutation!: UseMutationReturn<typeof target>;
    function View() {
      mutation = useMutation(target);
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));

    goOffline();
    await act(async () => {
      await expect(mutation.mutateAsync()).rejects.toThrow("network down");
    });

    expect(target).toHaveBeenCalledTimes(1);
    expect(mutation.paused).toBe(false);
    expect(mutation.status).toBe("error");
  });

  it("pauses a dispatch that failed while offline and retries it on reconnect", async () => {
    let releaseFirstAttempt!: () => void;
    const firstAttemptGate = new Promise<void>((resolve) => {
      releaseFirstAttempt = resolve;
    });
    let calls = 0;
    const target = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        // The connection drops while this dispatch is in flight. A real fetch
        // failure surfaces as a TypeError.
        await firstAttemptGate;
        throw new TypeError("Failed to fetch");
      }
      return "ok";
    });
    let mutation!: UseMutationReturn<typeof target>;
    function View() {
      mutation = useMutation(target, { networkMode: "online" });
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));

    let settled: Promise<string>;
    await act(async () => {
      settled = mutation.mutateAsync();
      await Promise.resolve();
      goOffline();
      releaseFirstAttempt();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls).toBe(1);
    expect(mutation.paused).toBe(true);
    expect(mutation.status).toBe("pending");

    await act(async () => {
      await goOnline();
      await expect(settled).resolves.toBe("ok");
    });

    expect(mutation.status).toBe("success");
    expect(calls).toBe(2);
  });

  it("surfaces an application error thrown while offline instead of pausing", async () => {
    // The request reaches the server and returns a typed business error, but the
    // connection flaps to offline before the response resolves. The error must
    // still reject: pausing would swallow it and re-submit the payload on
    // reconnect, duplicating a non-idempotent write.
    let releaseFirstAttempt!: () => void;
    const firstAttemptGate = new Promise<void>((resolve) => {
      releaseFirstAttempt = resolve;
    });
    let calls = 0;
    const businessError = Object.assign(new Error("insufficient funds"), { code: "invalid" });
    const target = vi.fn(async () => {
      calls += 1;
      // In flight while the connection drops, then the server's business error
      // arrives.
      await firstAttemptGate;
      throw businessError;
    });
    let mutation!: UseMutationReturn<typeof target>;
    function View() {
      mutation = useMutation(target, { networkMode: "online" });
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));

    let settled!: Promise<unknown>;
    await act(async () => {
      settled = mutation.mutateAsync().then(
        (value) => ({ ok: value }),
        (error) => ({ error }),
      );
      await Promise.resolve();
      goOffline();
      releaseFirstAttempt();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await settled).toEqual({ error: businessError });
    expect(calls).toBe(1);
    expect(mutation.paused).toBe(false);
    expect(mutation.status).toBe("error");

    // Reconnecting must not silently re-run the mutation.
    await act(async () => {
      await goOnline();
      await Promise.resolve();
    });
    expect(calls).toBe(1);
  });

  it("rejects a paused submission on reset instead of waiting forever", async () => {
    const target = vi.fn(async () => "never");
    let mutation!: UseMutationReturn<typeof target>;
    function View() {
      mutation = useMutation(target, { networkMode: "online" });
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));

    goOffline();
    let rejected: Error | undefined;
    await act(async () => {
      mutation.mutateAsync().catch((error: Error) => {
        rejected = error;
      });
      await Promise.resolve();
    });
    expect(mutation.paused).toBe(true);

    await act(async () => {
      mutation.reset();
      await Promise.resolve();
    });

    expect(rejected?.message).toMatch(/reset while waiting/);
    expect(mutation.paused).toBe(false);
    expect(mutation.status).toBe("idle");

    // A later reconnect must not dispatch the disowned submission.
    await act(async () => {
      await goOnline();
    });
    expect(target).not.toHaveBeenCalled();
  });

  it("exposes the paused state on useFetcher", async () => {
    const target = vi.fn(async (value: { name: string }) => value);
    let fetcher!: UseFetcherReturn<typeof target>;
    function View() {
      fetcher = useFetcher(target, { networkMode: "online" });
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));

    goOffline();
    let settled: Promise<unknown>;
    await act(async () => {
      settled = fetcher.submitAsync({ name: "Ada" });
      await Promise.resolve();
    });

    expect(fetcher.paused).toBe(true);
    expect(fetcher.state).toBe("submitting");

    await act(async () => {
      await goOnline();
      await settled;
    });

    expect(fetcher.paused).toBe(false);
    expect(fetcher.status).toBe("success");
  });
});
