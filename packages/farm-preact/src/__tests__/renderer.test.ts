// @vitest-environment node

import { Writable } from "node:stream";
import {
  defineRendererDescriptorConformance,
  defineRendererServerConformance,
} from "@farm.js/renderer-tests";
import { lazy } from "preact/compat";
import { describe, expect, it } from "vitest";
import { preact } from "../index";
import * as serverRuntime from "../server";
import {
  Suspense,
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
    capabilities: {
      streaming: { node: true, web: true },
      functionComponents: true,
    },
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

  it("puts Farm's CSP nonce on the streaming init script only", async () => {
    const suspended = () => {
      const Late = lazy(async () => ({
        default: () => createElement("p", null, "late content"),
      }));
      return createElement(
        "main",
        null,
        createElement("div", {
          dangerouslySetInnerHTML: { __html: '<script nonce="guess">injected()</script>' },
        }),
        createElement(
          Suspense,
          { fallback: createElement("p", null, "waiting") },
          createElement(Late, null),
        ),
      );
    };
    const scriptTags = (html: string) => html.match(/<script\b[^>]*>/g) ?? [];
    const expectSecured = (html: string) => {
      expect(html).toContain("late content");
      expect(html).toContain('<script nonce="abc123">(function(){class e extends HTMLElement');
      expect(scriptTags(html).filter((tag) => tag.includes('nonce="abc123"'))).toHaveLength(1);
      expect(html).toContain('<script nonce="guess">injected()</script>');
    };

    expectSecured(
      await new Response(renderToReadableStream(suspended(), { nonce: "abc123" })).text(),
    );
    expectSecured(
      await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const destination = new Writable({
          write(chunk, _encoding, callback) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            callback();
          },
        });
        destination.once("finish", () => resolve(Buffer.concat(chunks).toString("utf8")));
        const stream = renderToPipeableStream(suspended(), {
          nonce: "abc123",
          onShellReady() {
            stream.pipe(destination);
          },
          onShellError: reject,
          onError: reject,
        });
      }),
    );
    const unsecured = await new Response(renderToReadableStream(suspended())).text();
    expect(unsecured).toContain("<script>(function(){class e extends HTMLElement");
  });

  it("does not require a renderer-specific hydration bootstrap", () => {
    expect(generateHydrationScript()).toBe("");
  });
});
