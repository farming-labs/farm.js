// @vitest-environment jsdom

import { defineRendererClientConformance } from "@farm.js/renderer-tests";
import { h, nextTick, type FunctionalComponent } from "vue";
import { describe, expect, it } from "vitest";
import * as clientRuntime from "../client";
import * as serverRuntime from "../server";

defineRendererClientConformance({
  reconcilesRerenders: true,
  name: "vue",
  client: clientRuntime,
  server: serverRuntime,
});

describe("Vue client functional components", () => {
  const Emphasis: FunctionalComponent = (_props, ctx) => h("em", ctx.attrs, ctx.slots.default?.());
  const markup = '<em data-kind="functional" class="native"><span>slotted</span></em>';
  const app = (createElement: typeof clientRuntime.createElement) =>
    createElement(
      Emphasis,
      { className: "native", "data-kind": "functional" },
      createElement("span", null, "slotted"),
    );

  it("mounts a native functional component with its slots and attrs", async () => {
    const container = document.createElement("div");
    const root = clientRuntime.createRoot(container);
    root.render(app(clientRuntime.createElement));
    await nextTick();

    expect(container.innerHTML).toBe(markup);
    root.unmount();
  });

  it("hydrates a native functional component without replacing server markup", async () => {
    const container = document.createElement("div");
    container.innerHTML = await serverRuntime.renderToString(app(serverRuntime.createElement));
    expect(container.innerHTML).toBe(markup);
    const serverElement = container.firstElementChild;

    const root = clientRuntime.hydrateRoot(container, app(clientRuntime.createElement));
    await nextTick();

    expect(container.firstElementChild).toBe(serverElement);
    expect(container.innerHTML).toBe(markup);
    root.unmount();
  });
});
