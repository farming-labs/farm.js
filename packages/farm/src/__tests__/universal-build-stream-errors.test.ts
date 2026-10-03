// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isFarmNotFoundError, isFarmRedirectError, notFound, redirect } from "../navigation-errors";

type RenderedElement = {
  html?: string;
  shellHtml: string;
  streamErrors: unknown[];
  stream?: ReadableStream<Uint8Array>;
};

type StreamRenderer = {
  renderFarmElement: (ReactDOMServer: unknown, element: unknown) => Promise<RenderedElement>;
};

// The production stream renderer only exists inside the generated-entry
// template, so extract it from the source and instantiate it with the same
// helpers the generated module imports from the production runtime, plus the
// streaming primitives the generated entry resolves for the target runtime.
function instantiateStreamRenderer(
  streamingCapabilities = { node: true, web: true },
): StreamRenderer {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "nitro", "universal-build.ts"),
    "utf-8",
  );
  const start = source.indexOf("async function renderFarmElement(ReactDOMServer, element)");
  const end = source.indexOf("function createFarmDocumentStream(");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const factory = new Function(
    "isFarmRedirectError",
    "isFarmNotFoundError",
    "farmRendererStreamingCapabilities",
    `${source.slice(start, end)}\nreturn { renderFarmElement, renderFarmElementToString };`,
  );
  return factory(isFarmRedirectError, isFarmNotFoundError, streamingCapabilities) as StreamRenderer;
}

function captureThrown(throwing: () => never): unknown {
  try {
    throwing();
  } catch (error) {
    return error;
  }
}

// Mimics renderToReadableStream for a tree whose shell renders but where a
// boundary reports an error through onError before the stream completes.
function readableStreamServer(boundaryError: unknown) {
  return {
    renderToReadableStream: async (
      _element: unknown,
      options: { onError: (error: unknown) => void },
    ) => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("<div>shell</div>"));
          options.onError(boundaryError);
          controller.enqueue(encoder.encode("<!--deferred-->"));
          controller.close();
        },
      });
      return Object.assign(stream, { allReady: Promise.resolve() });
    },
  };
}

// Mimics renderToPipeableStream for the same scenario on the node path.
function pipeableStreamServer(boundaryError: unknown) {
  return {
    renderToPipeableStream: (
      _element: unknown,
      options: {
        onShellReady: () => void;
        onAllReady: () => void;
        onError: (error: unknown) => void;
      },
    ) => {
      const pipeable = {
        pipe(destination: { write: (chunk: unknown) => boolean; end: () => void }) {
          destination.write("<div>shell</div>");
          destination.write("<!--resolved-->");
          destination.end();
          return destination;
        },
      };
      options.onError(boundaryError);
      options.onAllReady();
      queueMicrotask(() => options.onShellReady());
      return pipeable;
    },
  };
}

// A tree that is still suspended when the shell is ready. `shellError` is
// reported while React renders the shell (a synchronous page under a loading
// boundary); `lateError` after the stream has been handed back.
function pendingReadableServer(options: { shellError?: unknown; lateError?: unknown }) {
  return {
    renderToReadableStream: async (
      _element: unknown,
      renderOptions: { onError: (error: unknown) => void },
    ) => {
      const encoder = new TextEncoder();
      let pulls = 0;
      if (options.shellError) renderOptions.onError(options.shellError);
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          pulls++;
          if (pulls === 1) {
            controller.enqueue(encoder.encode("<div>shell</div>"));
            return;
          }
          // The suspended boundary settles later, after the response started.
          await new Promise((resolve) => setTimeout(resolve, 10));
          if (options.lateError) renderOptions.onError(options.lateError);
          controller.enqueue(encoder.encode("<!--late-->"));
          controller.close();
        },
      });
      return Object.assign(stream, { allReady: new Promise(() => {}) });
    },
  };
}

function pendingPipeableServer(shellError: unknown) {
  const aborted: unknown[] = [];
  return {
    aborted,
    renderToPipeableStream: (
      _element: unknown,
      renderOptions: { onShellReady: () => void; onError: (error: unknown) => void },
    ) => {
      renderOptions.onError(shellError);
      queueMicrotask(() => renderOptions.onShellReady());
      return {
        pipe(destination: { write: (chunk: unknown) => boolean }) {
          destination.write("<div>shell</div>");
          return destination;
        },
        abort(reason: unknown) {
          aborted.push(reason);
        },
      };
    },
  };
}

// A pipeable tree that is still suspended after onShellReady and reports
// `lateError` once the stream has been handed back.
function latePipeableServer(lateError: unknown) {
  return {
    renderToPipeableStream: (
      _element: unknown,
      renderOptions: { onShellReady: () => void; onError: (error: unknown) => void },
    ) => {
      queueMicrotask(() => renderOptions.onShellReady());
      return {
        pipe(destination: { write: (chunk: unknown) => boolean; end: () => void }) {
          destination.write("<div>shell</div>");
          setTimeout(() => {
            renderOptions.onError(lateError);
            destination.write("<!--late-->");
            destination.end();
          }, 10);
          return destination;
        },
        abort() {},
      };
    },
  };
}

describe("generated production stream renderer control-flow errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves but does not log redirect() on the readable-stream path", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { renderFarmElement } = instantiateStreamRenderer();
    const redirectError = captureThrown(() => redirect("/login"));

    await expect(renderFarmElement(readableStreamServer(redirectError), null)).rejects.toBe(
      redirectError,
    );
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("preserves but does not log notFound() on the readable-stream path", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { renderFarmElement } = instantiateStreamRenderer();
    const notFoundError = captureThrown(() => notFound());

    await expect(renderFarmElement(readableStreamServer(notFoundError), null)).rejects.toBe(
      notFoundError,
    );
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("still logs and rethrows real errors on the readable-stream path", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { renderFarmElement } = instantiateStreamRenderer();

    await expect(renderFarmElement(readableStreamServer(new Error("boom")), null)).rejects.toThrow(
      "boom",
    );
    expect(consoleError).toHaveBeenCalledWith("[Farm SSR stream]", expect.any(Error));
  });

  it("preserves but does not log redirect() on the pipeable-stream path", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { renderFarmElement } = instantiateStreamRenderer();
    const redirectError = captureThrown(() => redirect("/login"));

    await expect(renderFarmElement(pipeableStreamServer(redirectError), null)).rejects.toBe(
      redirectError,
    );
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("preserves but does not log notFound() on the pipeable-stream path", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { renderFarmElement } = instantiateStreamRenderer();
    const notFoundError = captureThrown(() => notFound());

    await expect(renderFarmElement(pipeableStreamServer(notFoundError), null)).rejects.toBe(
      notFoundError,
    );
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("still logs and rethrows real errors on the pipeable-stream path", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { renderFarmElement } = instantiateStreamRenderer();

    await expect(renderFarmElement(pipeableStreamServer(new Error("boom")), null)).rejects.toThrow(
      "boom",
    );
    expect(consoleError).toHaveBeenCalledWith("[Farm SSR stream]", expect.any(Error));
  });

  it("does not stream a suspended tree after notFound() or redirect() in the shell pass", async () => {
    for (const thrown of [
      captureThrown(() => notFound()),
      captureThrown(() => redirect("/login")),
    ]) {
      const web = instantiateStreamRenderer({ node: false, web: true });
      await expect(
        web.renderFarmElement(pendingReadableServer({ shellError: thrown }), null),
      ).rejects.toBe(thrown);

      const node = instantiateStreamRenderer({ node: true, web: false });
      const server = pendingPipeableServer(thrown);
      await expect(node.renderFarmElement(server, null)).rejects.toBe(thrown);
      expect(server.aborted).toEqual([thrown]);
    }
  });

  it("keeps streaming on the pipeable path when notFound() arrives after the shell", async () => {
    const { renderFarmElement } = instantiateStreamRenderer({ node: true, web: false });
    const late = captureThrown(() => notFound());
    const rendered = await renderFarmElement(latePipeableServer(late), null);

    expect(rendered.stream).toBeDefined();
    expect(await new Response(rendered.stream).text()).toBe("<div>shell</div><!--late-->");
    expect(rendered.streamErrors).toEqual([late]);
  });

  it("keeps streaming when notFound() arrives after the shell was handed back", async () => {
    const { renderFarmElement } = instantiateStreamRenderer({ node: false, web: true });
    const late = captureThrown(() => notFound());
    const rendered = await renderFarmElement(pendingReadableServer({ lateError: late }), null);

    expect(rendered.stream).toBeDefined();
    expect(await new Response(rendered.stream).text()).toBe("<div>shell</div><!--late-->");
    expect(rendered.streamErrors).toEqual([late]);
  });

  it("takes only the stream primitive the resolved runtime declares", async () => {
    const calls: string[] = [];
    const encoder = new TextEncoder();
    // React 19's Node server build exports both primitives.
    const bothPrimitives = {
      renderToReadableStream: async () => {
        calls.push("web");
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("<div>web</div>"));
            controller.close();
          },
        });
        return Object.assign(stream, { allReady: Promise.resolve() });
      },
      renderToPipeableStream: (
        _element: unknown,
        options: { onShellReady: () => void; onAllReady: () => void },
      ) => {
        calls.push("node");
        options.onAllReady();
        queueMicrotask(() => options.onShellReady());
        return {
          pipe(destination: { write: (chunk: unknown) => boolean; end: () => void }) {
            destination.write("<div>node</div>");
            destination.end();
            return destination;
          },
        };
      },
    };

    const nodeTarget = await instantiateStreamRenderer({
      node: true,
      web: false,
    }).renderFarmElement(bothPrimitives, null);
    const edgeTarget = await instantiateStreamRenderer({
      node: false,
      web: true,
    }).renderFarmElement(bothPrimitives, null);
    expect(calls).toEqual(["node", "web"]);
    expect(nodeTarget.html).toBe("<div>node</div>");
    expect(edgeTarget.html).toBe("<div>web</div>");
  });
});
