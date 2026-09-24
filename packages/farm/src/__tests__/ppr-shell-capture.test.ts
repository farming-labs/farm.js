// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ServerRenderer } from "../server/renderer";

/**
 * A PPR shell capture must store only content the renderer split out as
 * static. A runtime without `findStaticShellBoundary` (Solid, Vue, Preact) or
 * a buffered render (Svelte, full-document routes) produces per-request HTML,
 * and caching that serves one visitor's data to everyone until revalidation.
 */

function createRenderer(runtime: Record<string, unknown>) {
  const config = { root: "/test", srcDir: "src", outDir: "dist", basePath: "/" };
  const renderer = new ServerRenderer(config as any, {} as any) as any;
  renderer.rendererRuntime = {
    createElement: (component: any, props: any, ...children: any[]) => ({
      component,
      props,
      children,
    }),
    ...runtime,
  };
  renderer.routeManager = {
    generateClientManifest: () => ({ routes: [], layouts: [], slots: [] }),
  };
  return renderer;
}

function fakeReq(pathname = "/ppr") {
  return { url: pathname, method: "GET", headers: {} } as any;
}

function fakeRes() {
  const headers = new Map<string, string>();
  const res: any = {
    headersSent: false,
    writableEnded: false,
    statusCode: 200,
    setHeader: (key: string, value: string) => headers.set(key.toLowerCase(), value),
    getHeader: (key: string) => headers.get(key.toLowerCase()),
    removeHeader: (key: string) => headers.delete(key.toLowerCase()),
    // The streaming Writable waits for this callback before accepting the
    // next chunk, so the fake must invoke it like a real ServerResponse.
    write: (_chunk: unknown, encoding?: unknown, callback?: unknown) => {
      if (typeof encoding === "function") (encoding as () => void)();
      else if (typeof callback === "function") (callback as () => void)();
      return true;
    },
    end: () => {
      res.writableEnded = true;
    },
  };
  return res;
}

function streamingRuntime(extra: Record<string, unknown> = {}) {
  return {
    renderToPipeableStream: (_element: unknown, hooks: any) => {
      queueMicrotask(() => hooks.onShellReady());
      return {
        pipe(writable: any) {
          writable.write("<div>logged-in as visitor-1</div>");
          writable.end();
        },
      };
    },
    ...extra,
  };
}

describe("PPR shell capture stores only renderer-split static content", () => {
  it("streams without caching when the runtime has no boundary detector", async () => {
    const onComplete = vi.fn();
    const renderer = createRenderer(streamingRuntime());

    await renderer.renderWithSSR({}, fakeReq(), fakeRes(), undefined, {
      captureStaticShell: true,
      onComplete,
      observabilityRoute: "/ppr",
    });

    // No findStaticShellBoundary means no static shell exists. Falling back to
    // the full streamed response cached this visitor's HTML for everyone.
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("still caches the split shell when the renderer owns a detector", async () => {
    const onComplete = vi.fn();
    const renderer = createRenderer(
      streamingRuntime({
        // Everything before the marker is static; nothing dynamic streamed.
        findStaticShellBoundary: () => -1,
      }),
    );

    await renderer.renderWithSSR({}, fakeReq(), fakeRes(), undefined, {
      captureStaticShell: true,
      onComplete,
      observabilityRoute: "/ppr",
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(String(onComplete.mock.calls[0]![0])).toContain("visitor-1");
  });

  it("never caches a buffered per-request document as the shell", async () => {
    const onComplete = vi.fn();
    const renderer = createRenderer({
      renderToString: async () => "<div>logged-in as visitor-1</div>",
    });

    await renderer.renderBufferedSSR({}, fakeReq(), fakeRes(), undefined, {
      captureStaticShell: true,
      onComplete,
      observabilityRoute: "/ppr",
    });

    expect(onComplete).not.toHaveBeenCalled();
  });
});
