// @vitest-environment jsdom

import { defineComponent, h, inject, nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as clientRuntime from "../client";
import * as serverRuntime from "../server";
import { defineVueApp, vue } from "../index";

const Greeting = defineComponent({
  name: "Greeting",
  setup() {
    const greeting = inject<string>("greeting", "missing");
    return () => h("p", greeting);
  },
});

afterEach(() => {
  serverRuntime.configureApp(undefined);
  clientRuntime.configureApp(undefined);
});

describe("Vue app setup", () => {
  it("passes the app setup module path to Farm as the renderer's appSetup", () => {
    expect(vue({ app: "./src/vue-app.ts" }).appSetup).toBe("./src/vue-app.ts");
    expect(vue()).not.toHaveProperty("appSetup");
  });

  it("configures every server app before it renders", async () => {
    const setup = vi.fn(
      defineVueApp((app, { ssr }) => {
        app.provide("greeting", ssr ? "hello from the server" : "wrong side");
      }),
    );
    serverRuntime.configureApp(setup);

    expect(await serverRuntime.renderToString(serverRuntime.createElement(Greeting))).toBe(
      "<p>hello from the server</p>",
    );
    expect(await serverRuntime.renderToString(serverRuntime.createElement(Greeting))).toBe(
      "<p>hello from the server</p>",
    );
    // One app per render keeps plugin state, such as a Pinia store, per request.
    expect(setup).toHaveBeenCalledTimes(2);
    expect(setup.mock.calls[0]?.[0]).not.toBe(setup.mock.calls[1]?.[0]);
  });

  it("configures the client app before mounting and before hydrating", async () => {
    serverRuntime.configureApp((app) => app.provide("greeting", "same on both sides"));
    clientRuntime.configureApp((app, { ssr }) => {
      expect(ssr).toBe(false);
      app.provide("greeting", "same on both sides");
    });

    const mounted = document.createElement("div");
    const root = clientRuntime.createRoot(mounted);
    root.render(clientRuntime.createElement(Greeting));
    await nextTick();
    expect(mounted.innerHTML).toBe("<p>same on both sides</p>");
    root.unmount();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hydrated = document.createElement("div");
    hydrated.innerHTML = await serverRuntime.renderToString(serverRuntime.createElement(Greeting));
    const serverParagraph = hydrated.firstElementChild;
    const hydratedRoot = clientRuntime.hydrateRoot(hydrated, clientRuntime.createElement(Greeting));
    await nextTick();
    expect(hydrated.firstElementChild).toBe(serverParagraph);
    expect(hydrated.innerHTML).toBe("<p>same on both sides</p>");
    expect(warn.mock.calls.flat().join(" ")).not.toContain("Hydration");
    hydratedRoot.unmount();
  });

  it("rejects an app setup module whose default export is not a function", () => {
    expect(() => serverRuntime.configureApp({ use: true })).toThrow(
      "The Vue app setup module must default-export a function",
    );
    expect(() => clientRuntime.configureApp("pinia")).toThrow(
      "The Vue app setup module must default-export a function",
    );
  });
});
