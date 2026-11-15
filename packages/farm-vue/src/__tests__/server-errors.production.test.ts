// @vitest-environment node

import { describe, expect, it } from "vitest";

import { defineComponent, h } from "vue";
import {
  createElement,
  renderToPipeableStream,
  renderToReadableStream,
  renderToString,
} from "../server";

/**
 * Vue's production build logs an error a component throws and renders on without it. The server
 * app rethrows it, as Vue's development build does, so Farm answers a thrown redirect(),
 * notFound() or error with its status instead of a 200 page missing the component.
 *
 * vitest.production.config.ts runs this file with Vue's production build.
 */
describe("Vue server rendering in production", () => {
  it.each([
    ["an error", () => new Error("kaboom")],
    [
      "a redirect()",
      () => Object.assign(new Error("NEXT_REDIRECT"), { digest: "FARM_REDIRECT;307;/" }),
    ],
    ["a notFound()", () => Object.assign(new Error("NOT_FOUND"), { digest: "FARM_NOT_FOUND" })],
  ])("rejects with %s a component throws", async (_label, createError) => {
    const thrown = createError();
    const Throws = defineComponent({
      name: "Throws",
      setup() {
        throw thrown;
      },
    });
    await expect(renderToString(createElement(Throws, null))).rejects.toBe(thrown);
  });

  it("carries a component's error to the reader of a Web stream", async () => {
    const thrown = new Error("kaboom");
    const Throws = defineComponent({
      name: "Throws",
      setup() {
        throw thrown;
      },
    });
    const stream = renderToReadableStream(createElement(Throws, null));
    await expect(stream.getReader().read()).rejects.toBe(thrown);
  });

  it("reports a component's error as a shell error of a Node stream", async () => {
    const thrown = new Error("kaboom");
    const Throws = defineComponent({
      name: "Throws",
      setup() {
        throw thrown;
      },
    });
    const shellError = await new Promise((resolve, reject) => {
      renderToPipeableStream(createElement(Throws, null), {
        onShellReady: () => reject(new Error("the shell should not be ready")),
        onShellError: resolve,
        onError: () => {},
      });
    });
    expect(shellError).toBe(thrown);
  });

  it("reports an error after output has gone out through onError and ends the Web stream", async () => {
    const thrown = new Error("late kaboom");
    const LateThrow = defineComponent({
      name: "LateThrow",
      async setup() {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw thrown;
      },
    });
    const Shell = defineComponent({
      name: "Shell",
      setup: () => () => h("main", [h("p", "shell content"), h(LateThrow)]),
    });
    const errors: unknown[] = [];
    const stream = renderToReadableStream(createElement(Shell, null), {
      onError: (error) => errors.push(error),
    });
    // The response that has started still ends cleanly instead of resetting the connection.
    const html = await new Response(stream).text();
    expect(html).toContain("shell content");
    expect(errors).toEqual([thrown]);
  });
});
