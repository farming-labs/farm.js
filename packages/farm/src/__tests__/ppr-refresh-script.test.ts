// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPPRRefreshScript, PPR_REFRESH_MAX_ATTEMPTS } from "../server/renderer";

/**
 * A cached PPR shell refreshes its dynamic content with one background request.
 * When that request failed, the latch it set was never cleared, so the page
 * stayed stale until a full reload. These run the inline script exactly as it
 * is emitted into the document.
 */

type Win = typeof window & {
  __FARM_PPR_REFRESHING__?: boolean;
  __FARM_PPR_HYDRATING__?: boolean;
  __FARM_PPR_REFRESH_PROMISE__?: Promise<void>;
};

function runRefreshScript() {
  const html = createPPRRefreshScript();
  const body = html.slice(html.indexOf(">") + 1, html.lastIndexOf("</script>"));
  new Function(body)();
}

const freshDocument = '<html><body><div id="root"><p>fresh</p></div></body></html>';

function respond(body: string, status = 200) {
  return Promise.resolve(new Response(body, { status, headers: { "content-type": "text/html" } }));
}

const rootText = () => document.getElementById("root")!.textContent;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="root"><p>stale shell</p></div>';
  delete (window as Win).__FARM_PPR_REFRESHING__;
  delete (window as Win).__FARM_PPR_HYDRATING__;
  delete (window as Win).__FARM_PPR_REFRESH_PROMISE__;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Let promise chains settle, then advance through any scheduled retry. */
async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
}

/** Whether hydration's await on the refresh has been released. */
function trackSettled() {
  const state = { settled: false };
  void (window as Win).__FARM_PPR_REFRESH_PROMISE__!.then(() => {
    state.settled = true;
  });
  return state;
}

describe("PPR background refresh", () => {
  it("bypasses HTTP caches when it requests the completed page", async () => {
    fetchMock.mockImplementation(() => respond(freshDocument));
    runRefreshScript();
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(window.location.href, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "x-farm-ppr-refresh": "1" },
    });
  });

  it("refreshes once and sends the refresh header", async () => {
    fetchMock.mockImplementation(() => respond(freshDocument));
    runRefreshScript();
    await settle();

    expect(rootText()).toBe("fresh");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ headers: { "x-farm-ppr-refresh": "1" } });

    // A second run in the same document is a no-op.
    runRefreshScript();
    await settle(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries after a rejected request and applies the next success", async () => {
    fetchMock
      .mockImplementationOnce(() => Promise.reject(new TypeError("network down")))
      .mockImplementation(() => respond(freshDocument));
    runRefreshScript();
    await settle();
    expect(rootText()).toBe("stale shell");

    await settle(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rootText()).toBe("fresh");
  });

  it("retries after a non-2xx response without touching the shell", async () => {
    fetchMock
      .mockImplementationOnce(() => respond('<div id="root">error page</div>', 503))
      .mockImplementation(() => respond(freshDocument));
    runRefreshScript();
    await settle();
    expect(rootText()).toBe("stale shell");

    await settle(1_000);
    expect(rootText()).toBe("fresh");
  });

  it("retries after a document with no root, keeping the shell", async () => {
    fetchMock
      .mockImplementationOnce(() => respond("<html><body><main>no root here</main></body></html>"))
      .mockImplementation(() => respond(freshDocument));
    runRefreshScript();
    await settle();
    expect(rootText()).toBe("stale shell");

    await settle(1_000);
    expect(rootText()).toBe("fresh");
  });

  it("stops after a bounded number of attempts and releases the latch", async () => {
    fetchMock.mockImplementation(() => respond("unavailable", 503));
    runRefreshScript();
    await settle(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(PPR_REFRESH_MAX_ATTEMPTS);
    expect(rootText()).toBe("stale shell");
    expect((window as Win).__FARM_PPR_REFRESHING__).toBe(false);

    // Nothing keeps polling once it has given up.
    await settle(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(PPR_REFRESH_MAX_ATTEMPTS);
  });

  it("waits for the browser to come back online instead of spending attempts", async () => {
    const onLine = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    fetchMock
      .mockImplementationOnce(() => Promise.reject(new TypeError("offline")))
      .mockImplementation(() => respond(freshDocument));
    runRefreshScript();
    await settle(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    onLine.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rootText()).toBe("fresh");
  });

  it("releases hydration after the first attempt, even when it fails", async () => {
    fetchMock
      .mockImplementationOnce(() => Promise.reject(new TypeError("network down")))
      .mockImplementation(() => respond(freshDocument));
    runRefreshScript();
    const hydration = trackSettled();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hydration.settled).toBe(true);
  });

  it("releases hydration only after a successful refresh has been applied", async () => {
    fetchMock.mockImplementation(() => respond(freshDocument));
    runRefreshScript();
    const hydration = trackSettled();
    await settle();

    expect(hydration.settled).toBe(true);
    expect(rootText()).toBe("fresh");
  });

  it("stops retrying once hydration has started", async () => {
    fetchMock
      .mockImplementationOnce(() => Promise.reject(new TypeError("network down")))
      .mockImplementation(() => respond(freshDocument));
    runRefreshScript();
    await settle();
    (window as Win).__FARM_PPR_HYDRATING__ = true;

    await settle(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rootText()).toBe("stale shell");
    expect((window as Win).__FARM_PPR_REFRESHING__).toBe(false);
  });

  it("drops a retry that lands after hydration has started", async () => {
    fetchMock
      .mockImplementationOnce(() => Promise.reject(new TypeError("network down")))
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve(respond(freshDocument)), 500)),
      );
    runRefreshScript();
    await settle(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    (window as Win).__FARM_PPR_HYDRATING__ = true;
    await settle(500);
    expect(rootText()).toBe("stale shell");
    expect((window as Win).__FARM_PPR_REFRESHING__).toBe(false);
  });
});
