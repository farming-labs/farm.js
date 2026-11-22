// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFarmDeploymentMismatchError,
  createFarmDeploymentRequestHeaders,
  isFarmDeploymentMismatchResponse,
} from "../deployment";
import { generateUniversalRouterStateRuntime } from "../nitro/universal-build";

afterEach(() => vi.unstubAllGlobals());

const html = (body: string) =>
  new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });

/**
 * Islands mode's production navigation request (fetchFarmNavigationDocument) beside a request the
 * boot script sent for a held link click (islands-boot.ts).
 */
function setup(early: { url?: string; headers?: Record<string, string>; at?: number } = {}) {
  const controller = new AbortController();
  const abort = vi.spyOn(controller, "abort");
  const response = Promise.resolve(html("<main>early</main>"));
  const window = {
    location: { href: "https://app.test/docs/a", assign: vi.fn() },
    __FARM_DEPLOYMENT_ID__: "d1",
    dispatchEvent: vi.fn(),
    __FARM_EARLY_NAVIGATION__: {
      url: early.url ?? "https://app.test/docs/b",
      headers: early.headers ?? {
        accept: "text/html",
        "x-farm-deployment-id": "d1",
        "f-layouts": '["/docs"]',
        "f-stream": "flush",
      },
      response,
      at: early.at ?? Date.now(),
      controller,
    } as Record<string, unknown> | undefined,
  };
  const fetchFarmNavigationDocument = new Function(
    "window",
    "createFarmDeploymentRequestHeaders",
    "isFarmDeploymentMismatchResponse",
    "createFarmDeploymentMismatchError",
    `${generateUniversalRouterStateRuntime(true)}
    return fetchFarmNavigationDocument;`,
  )(
    window,
    createFarmDeploymentRequestHeaders,
    isFarmDeploymentMismatchResponse,
    createFarmDeploymentMismatchError,
  ) as (
    url: string,
    headers: Record<string, string>,
    recover?: boolean,
    signal?: AbortSignal,
  ) => Promise<Response>;
  const fetch = vi.fn(async () => html("<main>own</main>"));
  vi.stubGlobal("fetch", fetch);
  return { window, abort, fetch, fetchFarmNavigationDocument };
}

const navigation = {
  Accept: "text/html",
  "F-Values": "04jiw29097x8ki",
  "F-Layouts": '["/docs"]',
  "F-Stream": "flush",
};

describe("a navigation request and the boot's request for a held click", () => {
  it("takes the response of the same request, whatever island values the router holds", async () => {
    const { window, abort, fetch, fetchFarmNavigationDocument } = setup();
    const response = await fetchFarmNavigationDocument("/docs/b", navigation);
    expect(await response.text()).toBe("<main>early</main>");
    expect(fetch).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
    expect(window.__FARM_EARLY_NAVIGATION__).toBeUndefined();
  });

  it("takes a whole page for a navigation that would stream it", async () => {
    // From under a layout that hydrates as one root, the boot asks for the next page whole.
    const { abort, fetch, fetchFarmNavigationDocument } = setup({
      headers: { accept: "text/html", "x-farm-deployment-id": "d1", "f-layouts": '["/docs"]' },
    });
    const response = await fetchFarmNavigationDocument("/docs/b", navigation);
    expect(await response.text()).toBe("<main>early</main>");
    expect(fetch).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
  });

  it("aborts a request that differs, and sends its own", async () => {
    const { "F-Stream": _stream, ...whole } = navigation;
    const cases: Array<[Parameters<typeof setup>[0], Record<string, string>]> = [
      [{ url: "https://app.test/docs/c" }, navigation],
      [
        { headers: { accept: "text/html", "x-farm-deployment-id": "d1", "f-stream": "flush" } },
        navigation,
      ],
      // A streamed response does not answer a request for the whole page.
      [{}, whole],
      [
        {
          headers: {
            accept: "text/html",
            "x-farm-deployment-id": "d1",
            "f-layouts": '["/docs"]',
            "f-render": "tree",
          },
        },
        navigation,
      ],
      // Sent over 30 seconds ago, like a prefetched page that went stale.
      [{ at: Date.now() - 31_000 }, navigation],
    ];
    for (const [early, request] of cases) {
      const { window, abort, fetch, fetchFarmNavigationDocument } = setup(early);
      const response = await fetchFarmNavigationDocument("/docs/b", request);
      expect(await response.text()).toBe("<main>own</main>");
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(abort).toHaveBeenCalledTimes(1);
      expect(window.__FARM_EARLY_NAVIGATION__).toBeUndefined();
    }
  });

  it("leaves it to the navigation when a prefetch asks", async () => {
    const { window, abort, fetch, fetchFarmNavigationDocument } = setup();
    const { "F-Stream": _stream, ...prefetch } = navigation;
    await fetchFarmNavigationDocument("/docs/b", prefetch, false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(abort).not.toHaveBeenCalled();
    expect(window.__FARM_EARLY_NAVIGATION__).toBeDefined();
    const response = await fetchFarmNavigationDocument("/docs/b", navigation);
    expect(await response.text()).toBe("<main>early</main>");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts the boot's request with the navigation that took it", async () => {
    const { abort, fetchFarmNavigationDocument } = setup();
    const controller = new AbortController();
    await fetchFarmNavigationDocument("/docs/b", navigation, true, controller.signal);
    expect(abort).not.toHaveBeenCalled();
    controller.abort();
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("is left out of a router that does not stream navigations", () => {
    expect(generateUniversalRouterStateRuntime(false)).not.toContain("__FARM_EARLY_NAVIGATION__");
    expect(generateUniversalRouterStateRuntime(true)).toContain("takeFarmEarlyNavigation(");
  });
});
