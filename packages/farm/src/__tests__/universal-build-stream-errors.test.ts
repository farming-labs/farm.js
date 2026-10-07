// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import React from "react";
import * as ReactDOMServer from "react-dom/server";
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
  primitives = { TextEncoder, TextDecoder, ReadableStream },
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
    "TextEncoder",
    "TextDecoder",
    "ReadableStream",
    `${source.slice(start, end)}\nreturn { renderFarmElement, renderFarmElementToString };`,
  );
  return factory(
    isFarmRedirectError,
    isFarmNotFoundError,
    streamingCapabilities,
    primitives.TextEncoder,
    primitives.TextDecoder,
    primitives.ReadableStream,
  ) as StreamRenderer;
}

function countedPrimitives() {
  const counts = { TextEncoder: 0, TextDecoder: 0, ReadableStream: 0 };
  function counted<T extends object>(key: keyof typeof counts, constructor: T): T {
    // Only instrument the extracted renderer, not the fixture or React itself.
    return new Proxy(constructor, {
      construct(target, args) {
        counts[key]++;
        return Reflect.construct(target, args);
      },
    });
  }
  return {
    counts,
    primitives: {
      TextEncoder: counted("TextEncoder", TextEncoder),
      TextDecoder: counted("TextDecoder", TextDecoder),
      ReadableStream: counted("ReadableStream", ReadableStream),
    },
  };
}

type Destination = { write(chunk: unknown): boolean; end(): void; destroy(error: Error): void };

function controlledNodeServer(chunks: unknown[], complete: boolean) {
  let destination!: Destination;
  const abort = vi.fn();
  return {
    abort,
    get destination() {
      return destination;
    },
    renderToPipeableStream(
      _element: unknown,
      options: { onShellReady(): void; onAllReady(): void },
    ) {
      if (complete) options.onAllReady();
      queueMicrotask(options.onShellReady);
      return {
        abort,
        pipe(target: Destination) {
          destination = target;
          for (const chunk of chunks) target.write(chunk);
          if (complete) target.end();
          return target;
        },
      };
    },
  };
}

describe("generated renderer allocation eligibility", () => {
  it.each(["node", "web"])(
    "buffers %s byte chunks without unused helpers and decodes split UTF-8",
    async (runtime) => {
      const { counts, primitives } = countedPrimitives();
      const bytes = new TextEncoder().encode("<p>🌱</p>");
      const chunks = [bytes.slice(0, 5), bytes.slice(5)];
      const server =
        runtime === "node"
          ? controlledNodeServer(chunks, true)
          : {
              renderToReadableStream: () =>
                Object.assign(
                  new ReadableStream({
                    start(controller) {
                      chunks.forEach((chunk) => controller.enqueue(chunk));
                      controller.close();
                    },
                  }),
                  { allReady: Promise.resolve() },
                ),
            };
      const rendered = await instantiateStreamRenderer(
        { node: runtime === "node", web: runtime === "web" },
        primitives,
      ).renderFarmElement(server, null);
      expect(rendered.html).toBe("<p>🌱</p>");
      expect(rendered.shellHtml).toBe(rendered.html);
      expect(rendered.stream).toBeUndefined();
      expect(counts).toEqual({ TextEncoder: 0, TextDecoder: 1, ReadableStream: 0 });
    },
  );

  it("creates one encoder when string chunks actually need it", async () => {
    const { counts, primitives } = countedPrimitives();
    const rendered = await instantiateStreamRenderer(
      { node: true, web: false },
      primitives,
    ).renderFarmElement(controlledNodeServer(["<p>", "🌱", "</p>"], true), null);
    expect(rendered.html).toBe("<p>🌱</p>");
    expect(counts).toEqual({ TextEncoder: 1, TextDecoder: 1, ReadableStream: 0 });
  });

  it("allocates no stream helpers for non-streaming renderer fallbacks", async () => {
    const { counts, primitives } = countedPrimitives();
    const renderer = instantiateStreamRenderer({ node: false, web: false }, primitives);
    expect(
      await renderer.renderFarmElement({ renderToString: () => "<p>plain</p>" }, null),
    ).toMatchObject({ html: "<p>plain</p>" });
    expect(
      await renderer.renderFarmElement(
        { renderToStringWithHead: () => ({ html: "<p>head</p>", head: "<title>Farm</title>" }) },
        null,
      ),
    ).toMatchObject({ html: "<p>head</p>", head: "<title>Farm</title>" });
    expect(counts).toEqual({ TextEncoder: 0, TextDecoder: 0, ReadableStream: 0 });
  });

  it("delivers the shell before completion and preserves late bytes and cancellation", async () => {
    const { counts, primitives } = countedPrimitives();
    const server = controlledNodeServer([new TextEncoder().encode("shell")], false);
    const rendered = await instantiateStreamRenderer(
      { node: true, web: false },
      primitives,
    ).renderFarmElement(server, null);
    expect(counts).toEqual({ TextEncoder: 0, TextDecoder: 1, ReadableStream: 1 });
    expect(rendered.shellHtml).toBe("shell");
    const reader = rendered.stream!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("shell");
    server.destination.write("🌱");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("🌱");
    await reader.cancel("navigation");
    expect(server.abort).toHaveBeenCalledExactlyOnceWith("navigation");
  });

  it("forwards late completion and fatal errors", async () => {
    for (const fail of [false, true]) {
      const server = controlledNodeServer(["shell"], false);
      const rendered = await instantiateStreamRenderer({
        node: true,
        web: false,
      }).renderFarmElement(server, null);
      const reader = rendered.stream!.getReader();
      await reader.read();
      if (fail) {
        const error = new Error("late failure");
        server.destination.destroy(error);
        await expect(reader.read()).rejects.toBe(error);
      } else {
        server.destination.end();
        expect((await reader.read()).done).toBe(true);
      }
    }
  });

  it("preserves real React synchronous output and Suspense streaming", async () => {
    const renderer = instantiateStreamRenderer({ node: true, web: false });
    expect(
      await renderer.renderFarmElement(ReactDOMServer, React.createElement("p", null, "🌱")),
    ).toMatchObject({ html: "<p>🌱</p>" });
    let ready = false;
    let resolve!: () => void;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    function Child() {
      if (!ready) throw pending;
      return React.createElement("p", null, "resolved 🌱");
    }
    const rendered = await renderer.renderFarmElement(
      ReactDOMServer,
      React.createElement(
        "main",
        null,
        React.createElement("h1", null, "shell"),
        React.createElement(
          React.Suspense,
          { fallback: React.createElement("p", null, "loading") },
          React.createElement(Child),
        ),
      ),
    );
    expect(rendered.stream).toBeDefined();
    // React may flush the first chunk after the renderer returns its stream.
    // Read it before resolving the boundary to prove progressive delivery.
    const reader = rendered.stream!.getReader();
    let html = new TextDecoder().decode((await reader.read()).value);
    expect(html).toContain("loading");
    ready = true;
    resolve();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      html += new TextDecoder().decode(chunk.value);
    }
    expect(html).toContain("loading");
    expect(html).toContain("resolved 🌱");
    expect(rendered.streamErrors).toEqual([]);
  });
});

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
