// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  getFarmRendererComponentExtensions,
  REACT_RENDERER,
  resolveFarmRenderer,
} from "../renderer";

describe("renderer configuration", () => {
  it("keeps React as the default renderer", () => {
    const renderer = resolveFarmRenderer();

    expect(renderer).toMatchObject({
      name: "react",
      server: "@farm.js/core/renderer/react/server",
      client: "@farm.js/core/renderer/react/client",
      jsxImportSource: "react",
    });
    expect(renderer).not.toBe(REACT_RENDERER);
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
