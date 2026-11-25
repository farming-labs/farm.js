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

  // Farm's production tree puts markup (a layout boundary) before the layouts and the page. Vue
  // wrote that markup, then awaited the page that had thrown, so the error came after output had
  // gone out: Farm answered 200 with a late not-found page, and a redirect() did not redirect.
  it.each([
    ["an error", () => new Error("kaboom")],
    [
      "a redirect()",
      () => Object.assign(new Error("NEXT_REDIRECT"), { digest: "FARM_REDIRECT;307;/" }),
    ],
    ["a notFound()", () => Object.assign(new Error("NOT_FOUND"), { digest: "FARM_NOT_FOUND" })],
  ])(
    "fails a Web stream before any output with %s a page below markup throws",
    async (_label, createError) => {
      const thrown = createError();
      const Page = defineComponent({
        name: "Page",
        setup() {
          throw thrown;
        },
      });
      const Layout = defineComponent({
        name: "Layout",
        setup:
          (_props, { slots }) =>
          () =>
            h("main", slots.default?.()),
      });
      const tree = createElement(
        "div",
        { "data-farm-layout-boundary": "true" },
        createElement(
          Layout,
          null,
          createElement("div", { id: "page" }, createElement(Page, null)),
        ),
      );
      await expect(renderToReadableStream(tree).getReader().read()).rejects.toBe(thrown);
    },
  );

  it("streams the markup before a component that waits", async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const Waits = defineComponent({
      name: "Waits",
      async setup() {
        await released;
        return () => h("p", "late content");
      },
    });
    const tree = createElement(
      "main",
      null,
      createElement("p", null, "early content"),
      createElement(Waits, null),
    );
    const reader = renderToReadableStream(tree).getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("early content");
    release();
    let rest = "";
    for (let result = await reader.read(); !result.done; result = await reader.read()) {
      rest += new TextDecoder().decode(result.value);
    }
    expect(rest).toContain("late content");
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
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const LateThrow = defineComponent({
      name: "LateThrow",
      async setup() {
        await released;
        throw thrown;
      },
    });
    const Shell = defineComponent({
      name: "Shell",
      setup: () => () => h("main", [h("p", "shell content"), h(LateThrow)]),
    });
    const errors: unknown[] = [];
    const reader = renderToReadableStream(createElement(Shell, null), {
      onError: (error) => errors.push(error),
    }).getReader();
    // The component throws only once output has gone out.
    let html = new TextDecoder().decode((await reader.read()).value);
    release();
    // The response that has started still ends cleanly instead of resetting the connection.
    for (let result = await reader.read(); !result.done; result = await reader.read()) {
      html += new TextDecoder().decode(result.value);
    }
    expect(html).toContain("shell content");
    expect(errors).toEqual([thrown]);
  });
});
