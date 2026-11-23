// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerRenderer } from "../server/renderer";
import { logger } from "../utils";

/**
 * A ServerRenderer with one route and no layouts, whose background regeneration resolves with the
 * document it caches and rejects with the error it logs.
 */
function regeneratePage(options: {
  capabilities?: { streaming?: { node?: boolean; web?: boolean } };
  runtime: Record<string, unknown>;
}): Promise<string> {
  const renderer = Object.create(ServerRenderer.prototype) as any;
  renderer.config = { renderer: { name: "test", capabilities: options.capabilities } };
  renderer.rendererRuntime = options.runtime;
  renderer.routeManager = {
    loadRouteModule: async () => ({ default: () => null }),
    matchRoute: () => ({ route: { pattern: "/crops" }, layouts: [] }),
    generateClientManifest: () => ({ routes: [], layouts: [] }),
  };
  renderer.createPageElement = async () => ({ page: "/crops" });
  renderer.createPageBoundary = async (element: unknown) => element;
  renderer.wrapWithIntegrationProviders = async (element: unknown) => element;
  renderer.resolveRouteMetadata = async () => ({});
  renderer.createFullHTML = (html: string, _hydrate: boolean, _path: string, head: string) =>
    `<head>${head}</head><body>${html}</body>`;
  vi.spyOn(logger, "info").mockImplementation(() => {});
  return new Promise((resolve, reject) => {
    renderer.cacheSSGPage = async (_page: unknown, document: string) => resolve(document);
    vi.spyOn(logger, "error").mockImplementation((message) => reject(new Error(message)));
    void renderer.regenerateSSGPage({
      urlPath: "/crops",
      filePath: "/app/src/app/crops/page.tsx",
      params: {},
      revalidate: 60,
    });
  });
}

function streamOf(html: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(html));
      controller.close();
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ISR regeneration", () => {
  it("renders through the stream, as a request does, when the renderer streams", async () => {
    const document = await regeneratePage({
      capabilities: { streaming: { web: true } },
      runtime: {
        // An async component, say, which the stream waits for and a string render can't.
        renderToString() {
          throw new Error("can't render an async component to a string");
        },
        renderToReadableStream: () => streamOf("<ul><li>wheat</li></ul>"),
      },
    });

    expect(document).toContain("<body><ul><li>wheat</li></ul></body>");
  });

  it("keeps the head markup and title the renderer emits", async () => {
    const document = await regeneratePage({
      runtime: {
        renderToString: () => "<h1>Crops</h1>",
        renderToStringWithHead: () => ({
          html: "<h1>Crops</h1>",
          head: '<title>Crops</title><meta name="description" content="What grows">',
        }),
      },
    });

    expect(document).toContain(
      '<title>Crops</title><meta name="description" content="What grows">',
    );
    // The route has no metadata title, so the framework's fallback title gives way, as it does
    // when a request renders the page.
    expect(document).not.toContain("<title>Farm.js App</title>");
    expect(document).toContain("<body><h1>Crops</h1></body>");
  });
});
