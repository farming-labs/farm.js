// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { ServerRenderer } from "../server/renderer";

function createRendererHarness(options: {
  capabilities?: { streaming?: { node?: boolean; web?: boolean } };
  runtime: Record<string, unknown>;
}) {
  const renderer = Object.create(ServerRenderer.prototype) as any;
  renderer.config = {
    renderer: {
      name: "test",
      capabilities: options.capabilities,
    },
  };
  renderer.rendererRuntime = options.runtime;
  return renderer;
}

describe("renderer capability dispatch", () => {
  it("uses an advertised Web stream before the buffered fallback", async () => {
    const renderToString = vi.fn(() => "buffered");
    const renderer = createRendererHarness({
      capabilities: { streaming: { web: true } },
      runtime: {
        renderToString,
        renderToReadableStream() {
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("<p>web stream</p>"));
              controller.close();
            },
          });
        },
      },
    });

    await expect(renderer.renderElementToCompleteHTML({})).resolves.toBe("<p>web stream</p>");
    expect(renderToString).not.toHaveBeenCalled();
  });

  it("keeps buffered SSR for legacy descriptors", async () => {
    const renderer = createRendererHarness({
      runtime: {
        renderToString: () => "<p>buffered</p>",
      },
    });

    await expect(renderer.renderElementToCompleteHTML({})).resolves.toBe("<p>buffered</p>");
  });
});
