/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPARouter } from "../client/spa-router";

interface PendingResponse {
  signal?: AbortSignal;
  resolve(response: Response): void;
}

describe("SPA router concurrent navigation", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the newest navigation when an older response finishes last", async () => {
    window.history.replaceState(null, "", "/start");
    const pending = new Map<string, PendingResponse>();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).searchParams.get("path")!;
        return new Promise<Response>((resolve) => {
          pending.set(path, { resolve, signal: init?.signal ?? undefined });
        });
      }),
    );

    const rendered: string[] = [];
    const router = new SPARouter({ scrollRestoration: false });
    router.setNavigationHandler(async (data) => {
      rendered.push(data.metadata?.title ?? "");
    });

    const slowNavigation = router.navigate("/slow", { scroll: false });
    await vi.waitFor(() => expect(pending.has("/slow")).toBe(true));
    const fastNavigation = router.navigate("/fast", { scroll: false });
    await vi.waitFor(() => expect(pending.has("/fast")).toBe(true));

    expect(pending.get("/slow")?.signal?.aborted).toBe(true);
    pending
      .get("/fast")!
      .resolve(Response.json({ props: {}, metadata: { title: "Fast" }, modulePath: "/fast.tsx" }));
    await fastNavigation;
    pending
      .get("/slow")!
      .resolve(Response.json({ props: {}, metadata: { title: "Slow" }, modulePath: "/slow.tsx" }));
    await slowNavigation;

    expect(rendered).toEqual(["Fast"]);
    expect(window.location.pathname).toBe("/fast");
    expect(document.title).toBe("Fast");
    router.destroy();
  });
});
