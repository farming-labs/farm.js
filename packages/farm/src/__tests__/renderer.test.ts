// @vitest-environment node

import {
  defineRendererDescriptorConformance,
  defineRendererServerConformance,
} from "@farm.js/renderer-tests";
import { describe, expect, it } from "vitest";
import {
  getFarmRendererCapabilities,
  getFarmRendererComponentExtensions,
  readFarmRendererWebStream,
  REACT_RENDERER,
  resolveFarmRenderer,
} from "../renderer";
import * as serverRuntime from "../renderer/react/server";

defineRendererDescriptorConformance({
  name: "react",
  createDescriptor: () => resolveFarmRenderer(),
  expected: {
    vite: "@farm.js/core/renderer/react/vite",
    server: "@farm.js/core/renderer/react/server",
    client: "@farm.js/core/renderer/react/client",
    jsxImportSource: "react",
    capabilities: { streaming: { node: true, web: false } },
  },
});

defineRendererServerConformance(serverRuntime);

describe("renderer configuration", () => {
  it("keeps React as the default renderer", () => {
    const renderer = resolveFarmRenderer();

    expect(renderer).toMatchObject({
      name: "react",
      server: "@farm.js/core/renderer/react/server",
      client: "@farm.js/core/renderer/react/client",
      jsxImportSource: "react",
      buildConcurrency: "parallel",
      capabilities: { streaming: { node: true, web: false } },
    });
    expect(renderer).not.toBe(REACT_RENDERER);
  });

  it("normalizes missing and partial capability declarations", () => {
    expect(getFarmRendererCapabilities()).toEqual({
      streaming: { node: false, web: false },
    });
    expect(
      getFarmRendererCapabilities({
        capabilities: { streaming: { web: true } },
      }),
    ).toEqual({
      streaming: { node: false, web: true },
    });
  });

  it("consumes renderer Web streams without assuming one chunk type", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array | string>({
      start(controller) {
        controller.enqueue(encoder.encode("<main>"));
        controller.enqueue("streamed");
        controller.enqueue(encoder.encode("</main>"));
        controller.close();
      },
    });

    await expect(readFarmRendererWebStream(stream)).resolves.toBe("<main>streamed</main>");
  });

  it("accepts a renderer descriptor without sharing mutable arrays", () => {
    const descriptor = {
      name: "test",
      vite: "test-renderer/vite",
      server: "test-renderer/server",
      client: "test-renderer/client",
      componentExtensions: ["vue"],
      dedupe: ["test-renderer"],
    };
    const renderer = resolveFarmRenderer(descriptor);

    expect(renderer).toMatchObject(descriptor);
    expect(renderer.componentExtensions).not.toBe(descriptor.componentExtensions);
    expect(renderer.dedupe).not.toBe(descriptor.dedupe);
  });

  it("preserves an explicit serial production-build policy", () => {
    const renderer = resolveFarmRenderer({
      name: "stateful-compiler",
      vite: "stateful-renderer/vite",
      server: "stateful-renderer/server",
      client: "stateful-renderer/client",
      buildConcurrency: "serial",
    });

    expect(renderer.buildConcurrency).toBe("serial");
  });

  it("adds renderer component extensions without dropping JavaScript routes", () => {
    expect(
      getFarmRendererComponentExtensions({ componentExtensions: ["vue", ".VUE", "svelte"] }),
    ).toEqual([".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte"]);
  });

  it("rejects incomplete renderer descriptors", () => {
    expect(() =>
      resolveFarmRenderer({
        name: "test",
        vite: "",
        server: "test-renderer/server",
        client: "test-renderer/client",
      }),
    ).toThrow(/renderer `vite` must be a non-empty string/i);
  });
});
