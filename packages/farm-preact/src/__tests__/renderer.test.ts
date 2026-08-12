// @vitest-environment node

import { Writable } from "node:stream";
import {
  defineRendererDescriptorConformance,
  defineRendererServerConformance,
} from "@farm.js/renderer-tests";
import { describe, expect, it } from "vitest";
import { preact } from "../index";
import * as serverRuntime from "../server";
import {
  createElement,
  generateHydrationScript,
  renderToPipeableStream,
  renderToReadableStream,
} from "../server";

defineRendererDescriptorConformance({
  name: "preact",
  createDescriptor: preact,
  expected: {
    vite: "@farm.js/preact/vite",
    server: "@farm.js/preact/server",
    client: "@farm.js/preact/client",
    jsxImportSource: "preact",
  },
});

defineRendererServerConformance(serverRuntime);

describe("Preact renderer", () => {
  it("streams FARMJS elements through Preact's Node renderer", async () => {
    const html = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const destination = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          callback();
        },
      });
      destination.once("finish", () => resolve(Buffer.concat(chunks).toString("utf8")));
      destination.once("error", reject);

      const stream = renderToPipeableStream(createElement("p", null, "Streamed from Preact"), {
        onShellReady() {
          stream.pipe(destination);
        },
        onShellError: reject,
        onError: reject,
      });
    });

    expect(html).toContain("<p>Streamed from Preact</p>");
  });

  it("streams FARMJS elements through the Web Streams renderer", async () => {
    const stream = renderToReadableStream(
      createElement("p", null, "Streamed through a readable stream"),
    );

    await expect(new Response(stream).text()).resolves.toContain(
      "<p>Streamed through a readable stream</p>",
    );
  });

  it("does not require a renderer-specific hydration bootstrap", () => {
    expect(generateHydrationScript()).toBe("");
  });
});
