// @vitest-environment node

import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { solid } from "../index";
import {
  createElement,
  generateHydrationScript,
  renderToPipeableStream,
  renderToReadableStream,
  renderToString,
} from "../server";

describe("Solid renderer", () => {
  it("returns an isolated renderer descriptor", () => {
    const first = solid();
    const second = solid();

    expect(first).toMatchObject({
      name: "solid",
      vite: "@farm.js/solid/vite",
      server: "@farm.js/solid/server",
      client: "@farm.js/solid/client",
      jsxImportSource: "solid-js",
      capabilities: { streaming: { node: true, web: true } },
    });
    expect(first.dedupe).not.toBe(second.dedupe);
    expect(first.optimizeDeps).not.toBe(second.optimizeDeps);
  });

  it("streams FARMJS elements through Solid's Node adapter", async () => {
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

      const stream = renderToPipeableStream(createElement("p", null, "Streamed from Solid"), {
        onShellReady() {
          stream.pipe(destination);
        },
        onShellError: reject,
        onError: reject,
      });
    });

    expect(html).toContain("Streamed from Solid");
  });

  it("streams FARMJS elements through Solid's Web adapter", async () => {
    const stream = renderToReadableStream(createElement("p", null, "Solid Web stream"));

    await expect(new Response(stream).text()).resolves.toContain("Solid Web stream");
  });

  it("renders FARMJS elements with Solid's server runtime", async () => {
    const html = await renderToString(
      createElement(
        "main",
        { className: "solid-app" },
        createElement("h1", null, "Hello from Solid"),
      ),
    );

    expect(html).toMatch(/<main[^>]+class="solid-app\s*"/);
    expect(html).toContain("Hello from Solid");
    expect(html).toContain("data-hk=");
  });

  it("provides Solid's hydration bootstrap for server documents", () => {
    expect(generateHydrationScript()).toContain("window._$HY");
  });
});
