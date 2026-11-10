// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createMarkdownMirrorResponse, resolveMarkdownConfig } from "../markdown";

describe("Markdown page request cancellation", () => {
  it.each(["GET", "HEAD"])("forwards an already-aborted %s request", async (method) => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    controller.abort(reason);
    const renderPage = vi.fn((request: Request) => {
      request.signal.throwIfAborted();
      return new Response("<h1>Account</h1>", { headers: { "content-type": "text/html" } });
    });
    await expect(
      createMarkdownMirrorResponse({
        request: new Request("https://farm.test/account.md", { method, signal: controller.signal }),
        config: resolveMarkdownConfig(true),
        renderPage,
      }),
    ).rejects.toBe(reason);
    expect(renderPage).toHaveBeenCalledOnce();
  });

  it.each([
    ["GET", "/account.md"],
    ["HEAD", "/account.md"],
    ["GET", "/account"],
    ["HEAD", "/account"],
  ])("cancels a cooperative render after %s %s has started", async (method, pathname) => {
    const controller = new AbortController();
    const request = new Request(`https://farm.test${pathname}?q=one&q=two&outline`, {
      method,
      signal: controller.signal,
      headers: { accept: "text/markdown", cookie: "session=caller" },
    });
    let didStart!: (request: Request) => void;
    const started = new Promise<Request>((resolve) => {
      didStart = resolve;
    });
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const outcome = createMarkdownMirrorResponse({
      request,
      config: resolveMarkdownConfig(true),
      renderPage: async (pageRequest) => {
        didStart(pageRequest);
        await gate;
        pageRequest.signal.throwIfAborted();
        return new Response("<h1>Account</h1>", { headers: { "content-type": "text/html" } });
      },
    }).then(
      (response) => ({ response, error: undefined }),
      (error) => ({ response: null, error }),
    );
    const pageRequest = await started;
    const reason = new Error("caller disconnected during render");
    controller.abort(reason);
    finish();
    expect((await outcome).error).toBe(reason);
    expect(pageRequest.signal.aborted).toBe(true);
    expect(pageRequest.signal.reason).toBe(reason);
    expect(pageRequest.url).toBe("https://farm.test/account?q=one&q=two");
    expect(pageRequest.method).toBe("GET");
    expect(pageRequest.headers.get("accept")).toBe("text/html");
    expect(pageRequest.headers.get("cookie")).toBe("session=caller");
    expect(request.url).toContain("outline");
    expect(request.headers.get("accept")).toBe("text/markdown");
  });

  it("leaves ordinary and disabled requests outside the render path, even when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const renderPage = vi.fn(() => new Response("unexpected"));
    for (const [pathname, enabled] of [
      ["/account", true],
      ["/account.md", false],
    ] as const) {
      expect(
        await createMarkdownMirrorResponse({
          request: new Request(`https://farm.test${pathname}`, { signal: controller.signal }),
          config: resolveMarkdownConfig(enabled),
          renderPage,
        }),
      ).toBeNull();
    }
    expect(renderPage).not.toHaveBeenCalled();
  });
});
