// @vitest-environment node

import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { preact } from "../index";
import {
  createElement,
  generateHydrationScript,
  renderToPipeableStream,
  renderToReadableStream,
  renderToString,
} from "../server";

describe("Preact renderer", () => {
  it("returns an isolated renderer descriptor", () => {
    const first = preact();
    const second = preact();

    expect(first).toMatchObject({
      name: "preact",
      vite: "@farm.js/preact/vite",
      server: "@farm.js/preact/server",
      client: "@farm.js/preact/client",
      jsxImportSource: "preact",
      capabilities: { streaming: { node: true, web: true } },
    });
    expect(first.dedupe).not.toBe(second.dedupe);
    expect(first.optimizeDeps).not.toBe(second.optimizeDeps);
  });

  it("renders FARMJS elements with Preact's server runtime", () => {
    const html = renderToString(
      createElement(
        "main",
        { className: "preact-app" },
        createElement("h1", null, "Hello from Preact"),
      ),
    );

    expect(html).toContain('<main class="preact-app">');
    expect(html).toContain("<h1>Hello from Preact</h1>");
  });

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
