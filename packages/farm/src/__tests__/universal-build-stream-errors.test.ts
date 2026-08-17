// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isFarmNotFoundError,
  isFarmRedirectError,
  notFound,
  redirect,
} from "../navigation-errors";

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
// helpers the generated module imports from the production runtime.
function instantiateStreamRenderer(): StreamRenderer {
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
    `${source.slice(start, end)}\nreturn { renderFarmElement, renderFarmElementToString };`,
  );
  return factory(isFarmRedirectError, isFarmNotFoundError) as StreamRenderer;
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

describe("generated production stream renderer control-flow errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not log or buffer redirect() on the readable-stream path", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { renderFarmElement } = instantiateStreamRenderer();

    const rendered = await renderFarmElement(
      readableStreamServer(captureThrown(() => redirect("/login"))),
      null,
    );

    expect(rendered.html).toBe("<div>shell</div><!--deferred-->");
    expect(rendered.streamErrors).toHaveLength(0);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("does not log or buffer notFound() on the readable-stream path", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { renderFarmElement } = instantiateStreamRenderer();

    const rendered = await renderFarmElement(
      readableStreamServer(captureThrown(() => notFound())),
      null,
    );

    expect(rendered.html).toBe("<div>shell</div><!--deferred-->");
    expect(rendered.streamErrors).toHaveLength(0);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("still logs and rethrows real errors on the readable-stream path", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { renderFarmElement } = instantiateStreamRenderer();

    await expect(
      renderFarmElement(readableStreamServer(new Error("boom")), null),
    ).rejects.toThrow("boom");
    expect(consoleError).toHaveBeenCalledWith("[Farm SSR stream]", expect.any(Error));
  });

  it("does not log or buffer redirect() on the pipeable-stream path", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { renderFarmElement } = instantiateStreamRenderer();

    const rendered = await renderFarmElement(
      pipeableStreamServer(captureThrown(() => redirect("/login"))),
      null,
    );

    expect(rendered.html).toBe("<div>shell</div><!--resolved-->");
    expect(rendered.streamErrors).toHaveLength(0);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("does not log or buffer notFound() on the pipeable-stream path", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { renderFarmElement } = instantiateStreamRenderer();

    const rendered = await renderFarmElement(
      pipeableStreamServer(captureThrown(() => notFound())),
      null,
    );

    expect(rendered.html).toBe("<div>shell</div><!--resolved-->");
    expect(rendered.streamErrors).toHaveLength(0);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("still logs and rethrows real errors on the pipeable-stream path", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { renderFarmElement } = instantiateStreamRenderer();

    await expect(
      renderFarmElement(pipeableStreamServer(new Error("boom")), null),
    ).rejects.toThrow("boom");
    expect(consoleError).toHaveBeenCalledWith("[Farm SSR stream]", expect.any(Error));
  });
});
