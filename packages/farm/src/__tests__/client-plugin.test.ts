/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createClientPluginManager,
  type FarmClientPlugin,
  type FarmClientPluginRegistration,
  type FarmClientPluginRouter,
} from "../client/plugin";

function createRouter(): FarmClientPluginRouter {
  return {
    async navigate() {},
    async prefetch() {},
  };
}

function createManager(registrations: FarmClientPluginRegistration[]) {
  return createClientPluginManager(registrations, {
    router: createRouter(),
    isDev: true,
    window,
  });
}

describe("client plugin lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs ordered hydration and navigation hooks with private state", async () => {
    const calls: string[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    const registration = (name: string, enforce?: "pre" | "post") => ({
      name,
      enforce,
      definition: {
        setup() {
          calls.push(`${name}:setup`);
          return { name };
        },
        hydration: {
          before({ state }) {
            calls.push(`${state.name}:hydrate:before`);
          },
          after({ state }) {
            calls.push(`${state.name}:hydrate:after`);
          },
        },
        navigation: {
          before({ state }) {
            calls.push(`${state.name}:navigate:before`);
          },
          loaded({ state }) {
            calls.push(`${state.name}:navigate:loaded`);
          },
          resolved({ state }) {
            calls.push(`${state.name}:navigate:resolved`);
          },
          rendered({ state }) {
            calls.push(`${state.name}:navigate:rendered`);
          },
        },
        close({ state }) {
          calls.push(`${state.name}:close`);
        },
      } as FarmClientPlugin<{ name: string }>,
    });

    const manager = createManager([
      registration("normal"),
      registration("post", "post"),
      registration("pre", "pre"),
    ]);
    await manager.start();

    const hydration = await manager.beginHydration({
      container: document.body,
      mode: "hydrate",
    });
    await manager.completeHydration(hydration);

    const navigation = await manager.beginNavigation({
      from: "/",
      to: "/products",
      action: "push",
    });
    await manager.markNavigationLoaded(navigation);
    await manager.resolveNavigation(navigation);
    await manager.scheduleNavigationRendered(navigation);
    await manager.close("manual");

    expect(calls).toEqual([
      "pre:setup",
      "normal:setup",
      "post:setup",
      "pre:hydrate:before",
      "normal:hydrate:before",
      "post:hydrate:before",
      "pre:hydrate:after",
      "normal:hydrate:after",
      "post:hydrate:after",
      "pre:navigate:before",
      "normal:navigate:before",
      "post:navigate:before",
      "pre:navigate:loaded",
      "normal:navigate:loaded",
      "post:navigate:loaded",
      "pre:navigate:resolved",
      "normal:navigate:resolved",
      "post:navigate:resolved",
      "pre:navigate:rendered",
      "normal:navigate:rendered",
      "post:navigate:rendered",
      "post:close",
      "normal:close",
      "pre:close",
    ]);
  });

  it("passes frozen public data to the inline client lifecycle", async () => {
    const received: unknown[] = [];
    const publicData = { projectId: "storefront" };
    const manager = createManager([
      {
        name: "analytics",
        public: publicData,
        definition: {
          setup(event) {
            received.push(
              event.public,
              Object.isFrozen(event.public),
              event.plugin.name,
              event.isDev,
            );
          },
        },
      },
    ]);

    await manager.start();

    expect(received).toEqual([publicData, true, "analytics", true]);
  });

  it("does not re-enter startup when setup reports an error", async () => {
    const calls: string[] = [];
    const failure = new Error("setup diagnostic");
    let manager: ReturnType<typeof createManager>;

    manager = createManager([
      {
        name: "reporter",
        enforce: "pre",
        definition: {
          error({ error, phase }) {
            calls.push(`${phase}:${error === failure}`);
          },
        },
      },
      {
        name: "diagnostic",
        definition: {
          async setup() {
            calls.push("setup");
            await manager.reportError(failure, "setup:diagnostic");
          },
        },
      },
    ]);

    await manager.start();

    expect(calls).toEqual(["setup", "setup:diagnostic:true"]);
    expect(manager.getPlugins()).toEqual([
      { name: "reporter", version: undefined },
      { name: "diagnostic", version: undefined },
    ]);
  });

  it("aborts superseded navigation sessions", async () => {
    const loaded: string[] = [];
    const manager = createManager([
      {
        name: "navigation-observer",
        definition: {
          navigation: {
            loaded({ to }) {
              loaded.push(to.pathname);
            },
          },
        },
      },
    ]);

    const first = await manager.beginNavigation({
      to: "/first",
      action: "push",
    });
    const second = await manager.beginNavigation({
      to: "/second",
      action: "replace",
    });
    await manager.markNavigationLoaded(first);
    await manager.markNavigationLoaded(second);

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(loaded).toEqual(["/second"]);
  });

  it("isolates failed hooks and reports them to sibling plugins", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("analytics unavailable");
    const manager = createManager([
      {
        name: "broken",
        definition: {
          navigation: {
            before() {
              throw failure;
            },
          },
        },
      },
      {
        name: "reporter",
        definition: {
          navigation: {
            before() {
              calls.push("continued");
            },
          },
          error({ error, phase }) {
            calls.push(`${phase}:${error === failure}`);
          },
        },
      },
    ]);

    await manager.beginNavigation({ to: "/account", action: "push" });

    expect(calls).toEqual(["plugin:navigation.before:true", "continued"]);
  });

  it("reports navigation failures without running resolved hooks", async () => {
    const calls: string[] = [];
    const failure = new Error("route chunk failed");
    const manager = createManager([
      {
        name: "errors",
        definition: {
          navigation: {
            resolved() {
              calls.push("resolved");
            },
            error({ error }) {
              calls.push(error === failure ? "navigation-error" : "unexpected");
            },
          },
          error({ phase }) {
            calls.push(phase);
          },
        },
      },
    ]);

    const navigation = await manager.beginNavigation({
      to: "/broken",
      action: "push",
    });
    await manager.failNavigation(navigation, failure);

    expect(calls).toEqual(["navigation-error", "navigation"]);
  });
});
