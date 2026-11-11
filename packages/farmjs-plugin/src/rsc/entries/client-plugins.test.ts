import { describe, expect, it, vi } from "vitest";
import { generateClientEntry } from "./client.js";
import type { EntryContext, FarmRscClientPlugins } from "../types.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  routesDir: "app",
  globalCssPath: undefined,
  actionsEnabled: true,
  serverActions: { allowedOrigins: [], bodySizeLimit: 500_000 },
  deploymentId: "plugins-test",
  debug: false,
};

// What core's generateFarmClientPluginEntryCode returns for a plugin and an app src/client.ts.
const clientPlugins: FarmRscClientPlugins = {
  empty: false,
  imports: 'import farmAppClientDefinition from "/app/src/client.ts";',
  registrations: `[
  {
    name: "recorder",
    definition: {
  "setup": (function setup() { return []; })
  },
  },
  {
    name: "farm:app-client",
    enforce: "post",
    definition: farmAppClientDefinition,
  }
]`,
};

const withPlugins = { ...context, clientPlugins };

/** A slice of the generated entry, from `start` up to `end`, as a function of its free names. */
function extract(entry: string, start: string, end: string, deps: Record<string, unknown>) {
  const from = entry.indexOf(start);
  const to = entry.indexOf(end, from);
  expect(from, start).toBeGreaterThan(-1);
  expect(to, end).toBeGreaterThan(from);
  const names = Object.keys(deps);
  return (source: string) =>
    new Function(...names, `${entry.slice(from, to)}\n${source}`)(...names.map((n) => deps[n]));
}

/** The manager calls refetch() makes, in order, with a fresh session per navigation. */
function recordingRuntime() {
  const calls: string[] = [];
  const sessions: Array<{ signal: AbortSignal; input: unknown }> = [];
  const runtime = {
    beginNavigation: vi.fn(async (input: unknown) => {
      calls.push("begin");
      const session = { signal: new AbortController().signal, input };
      sessions.push(session);
      return session;
    }),
    markNavigationLoaded: vi.fn(async () => void calls.push("loaded")),
    resolveNavigation: vi.fn(async () => void calls.push("resolved")),
    scheduleNavigationRendered: vi.fn(async () => void calls.push("rendered")),
    failNavigation: vi.fn(async () => void calls.push("failed")),
  };
  return { calls, sessions, runtime };
}

function buildRefetch(deps: Record<string, unknown>) {
  return extract(
    generateClientEntry(withPlugins),
    "async function refetch(url, navigation) {",
    "// A root layout that renders <html>",
    {
      debug: () => {},
      createFarmDeploymentRequestHeaders: () => ({}),
      farmDeploymentId: "plugins-test",
      isFarmDeploymentMismatchResponse: () => false,
      reportDeploymentMismatch: () => new Error("mismatch"),
      setPayloadRef: { current: vi.fn() },
      location: { href: "https://app.test/notes", assign: vi.fn() },
      history: { replaceState: vi.fn() },
      console: { error: () => {} },
      ...deps,
    },
  )("return refetch;") as (url: string, navigation?: object) => Promise<void>;
}

describe("the RSC browser entry and client plugins", () => {
  it("adds nothing for an app without client plugins", () => {
    const entry = generateClientEntry(context);
    expect(
      generateClientEntry({ ...context, clientPlugins: { ...clientPlugins, empty: true } }),
    ).toBe(entry);
    expect(entry).not.toContain("createClientPluginManager");
    expect(entry).not.toContain("farmClientRuntime");
  });

  it("starts the client plugin manager with the app's registrations", () => {
    const entry = generateClientEntry(withPlugins);
    expect(entry).toContain(
      "import { createClientPluginManager } from '@farm.js/core/internal/client-runtime';",
    );
    expect(entry).toContain(clientPlugins.imports);
    expect(entry).toContain(`createClientPluginManager(\n  ${clientPlugins.registrations},`);
    expect(entry).toContain("void farmClientRuntime.start();");
    expect(entry).toContain("import.meta.hot.dispose(() => farmClientRuntime.close('hmr'));");
  });

  it("hands plugins a router that waits for the page to hydrate", async () => {
    const entry = generateClientEntry(withPlugins);
    let options: any;
    let registrations: any;
    const appClient = { setup() {} };
    const farmNavigateRef = { current: vi.fn(async () => {}) };
    const window = {} as Record<string, unknown>;
    const manager = { start: vi.fn(async () => {}), close: vi.fn() };
    const hot = { dispose: vi.fn() };
    // `import.meta` only parses in a module, so the slice reads it from a parameter.
    const runtimeBlock = entry.replaceAll("import.meta", "importMeta");
    const run = extract(
      runtimeBlock,
      "let farmRouterReady;",
      "// Every payload the root is given",
      {
        createClientPluginManager: (pluginRegistrations: unknown, managerOptions: unknown) => {
          registrations = pluginRegistrations;
          options = managerOptions;
          return manager;
        },
        farmAppClientDefinition: appClient,
        farmNavigateRef,
        farmDeploymentId: "plugins-test",
        window,
        importMeta: { env: { DEV: false, PROD: true }, hot },
      },
    );
    const { ready, refreshRef } = run(
      "return { ready: farmRouterReady, refreshRef: farmRefreshRef };",
    ) as { ready: () => void; refreshRef: { current: () => Promise<void> } };
    expect(registrations.map((plugin: { name: string }) => plugin.name)).toEqual([
      "recorder",
      "farm:app-client",
    ]);
    expect(registrations[1].definition).toBe(appClient);
    expect(window.__FARM_CLIENT_RUNTIME__).toBe(manager);
    expect(manager.start).toHaveBeenCalledOnce();
    // The entry announces navigations itself.
    expect(options).toMatchObject({
      isDev: false,
      isProd: true,
      deploymentId: "plugins-test",
      announceRoutes: false,
    });
    // An HMR update that replaces this module closes the plugins first.
    hot.dispose.mock.calls[0]![0]();
    expect(manager.close).toHaveBeenCalledWith("hmr");

    refreshRef.current = vi.fn(async () => {});
    const navigation = options.router.navigate("/notes/2", { replace: true });
    const push = options.router.navigate("/notes/3");
    const refresh = options.router.refresh();
    await Promise.resolve();
    expect(farmNavigateRef.current).not.toHaveBeenCalled();
    ready();
    await Promise.all([navigation, push, refresh]);
    expect(farmNavigateRef.current).toHaveBeenNthCalledWith(1, "/notes/2", "replace");
    expect(farmNavigateRef.current).toHaveBeenNthCalledWith(2, "/notes/3", "push");
    expect(refreshRef.current).toHaveBeenCalledOnce();
  });

  it("runs the navigation hooks around a navigation's payload", async () => {
    const { calls, runtime } = recordingRuntime();
    const payload = { rootContent: "page" };
    const farmCommitPayload = vi.fn(async () => void calls.push("commit"));
    const refetch = buildRefetch({
      farmClientRuntime: runtime,
      farmCommitPayload,
      fetch: async () => ({ ok: true, body: {} }),
      createFromReadableStream: async () => payload,
    });

    await refetch("https://app.test/notes/2", { action: "push", from: "https://app.test/notes" });
    expect(runtime.beginNavigation).toHaveBeenCalledWith({
      from: "https://app.test/notes",
      to: "https://app.test/notes/2",
      action: "push",
    });
    // `resolved` waits for React to commit the payload, and `rendered` comes after.
    await vi.waitFor(() =>
      expect(calls).toEqual(["begin", "loaded", "commit", "resolved", "rendered"]),
    );
    expect(farmCommitPayload).toHaveBeenCalledWith(payload, expect.any(AbortSignal));
  });

  it("finishes a navigation without waiting for React to commit it", async () => {
    // A server action that redirects awaits the navigation, and React commits the new payload
    // only once that action is done: refetch() waiting for the commit would never finish.
    const { calls, runtime } = recordingRuntime();
    const refetch = buildRefetch({
      farmClientRuntime: runtime,
      farmCommitPayload: vi.fn(() => {
        calls.push("set");
        return new Promise<void>(() => {});
      }),
      fetch: async () => ({ ok: true, body: {} }),
      createFromReadableStream: async () => ({ rootContent: "target" }),
    });

    await refetch("https://app.test/target", { action: "push", from: "https://app.test/form" });
    expect(calls).toEqual(["begin", "loaded", "set"]);
    expect(runtime.resolveNavigation).not.toHaveBeenCalled();
  });

  it("resolves a navigation once React commits its payload or a later one", async () => {
    const entry = generateClientEntry(withPlugins);
    const slice = (start: string, end: string) => {
      const from = entry.indexOf(start);
      expect(from, start).toBeGreaterThan(-1);
      return entry.slice(from, entry.indexOf(end, from));
    };
    // BrowserRoot's payload setter and its commit effect, run against a root that commits the
    // payload it was given last, as a transition does.
    const harness = extract(
      entry,
      "let farmPayloadCount = 0;",
      "// A server component that fails",
      {
        setPayloadRef: { current: null },
        React: { startTransition: (update: () => void) => update() },
      },
    )(`
      let state;
      const set = (p) => { state = p; };
      ${slice("setPayloadRef.current = (p) => {", "farmRouterReady();")}
      return {
        commitPayload: farmCommitPayload,
        commit() {
          const payload = state;
          ${slice("const committed = farmPayloadSequence.get(payload) ?? 0;", "}, [payload]);")}
        },
      };
    `) as {
      commitPayload: (payload: object, signal: AbortSignal) => Promise<void>;
      commit: () => void;
    };
    const settled = (promise: Promise<void>) => {
      let done = false;
      void promise.then(() => (done = true));
      return () => done;
    };
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    const first = settled(harness.commitPayload({ page: 1 }, new AbortController().signal));
    const second = settled(harness.commitPayload({ page: 2 }, new AbortController().signal));
    await flush();
    expect([first(), second()]).toEqual([false, false]);
    // React skips straight to the second payload: the first navigation is done too.
    harness.commit();
    await flush();
    expect([first(), second()]).toEqual([true, true]);

    // A navigation a newer one already superseded waits for nothing.
    const superseded = new AbortController();
    superseded.abort("superseded");
    const late = settled(harness.commitPayload({ page: 3 }, superseded.signal));
    await flush();
    expect(late()).toBe(true);
  });

  it("refreshes without hooks when nothing navigated", async () => {
    const { calls, runtime } = recordingRuntime();
    const setPayloadRef = { current: vi.fn() };
    const refetch = buildRefetch({
      farmClientRuntime: runtime,
      farmCommitPayload: vi.fn(),
      setPayloadRef,
      fetch: async () => ({ ok: true, body: {} }),
      createFromReadableStream: async () => ({ rootContent: "page" }),
    });

    // HMR refetches the page on screen; it is not a navigation.
    await refetch("https://app.test/notes");
    expect(calls).toEqual([]);
    expect(setPayloadRef.current).toHaveBeenCalledWith({ rootContent: "page" });
  });

  it("reports a failed navigation before loading the page as a document", async () => {
    const failures = [
      { fetch: async () => ({ ok: false, status: 500, body: {} }), error: "RSC fetch failed: 500" },
      {
        fetch: async () => {
          throw new Error("offline");
        },
        error: "offline",
      },
    ];
    for (const failure of failures) {
      const { calls, runtime, sessions } = recordingRuntime();
      const location = { href: "https://app.test/notes", assign: vi.fn() };
      const refetch = buildRefetch({
        farmClientRuntime: runtime,
        farmCommitPayload: vi.fn(),
        fetch: failure.fetch,
        createFromReadableStream: async () => ({}),
        location,
      });

      await refetch("https://app.test/notes/2", { action: "pop", from: null });
      expect(calls).toEqual(["begin", "failed"]);
      expect(runtime.failNavigation).toHaveBeenCalledWith(
        sessions[0],
        expect.objectContaining({ message: failure.error }),
      );
      expect(location.href).toBe("https://app.test/notes/2");
    }
  });

  it("reports a deployment mismatch and reloads the page, as before", async () => {
    const { calls, runtime, sessions } = recordingRuntime();
    const mismatch = new Error("mismatch");
    const location = { href: "https://app.test/notes", assign: vi.fn() };
    const refetch = buildRefetch({
      farmClientRuntime: runtime,
      farmCommitPayload: vi.fn(),
      fetch: async () => ({ ok: false, status: 409, body: {} }),
      createFromReadableStream: async () => ({}),
      isFarmDeploymentMismatchResponse: () => true,
      reportDeploymentMismatch: () => mismatch,
      location,
    });

    await refetch("https://app.test/notes/2", { action: "push", from: "https://app.test/notes" });
    expect(calls).toEqual(["begin", "failed"]);
    expect(runtime.failNavigation).toHaveBeenCalledWith(sessions[0], mismatch);
    expect(location.assign).toHaveBeenCalledWith("https://app.test/notes/2");
  });

  it("passes each navigation's action and starting URL to refetch()", async () => {
    const { location, history, refetch } = (() => {
      const url = new URL("https://app.test/notes?tab=1");
      const location = {
        get href() {
          return url.href;
        },
        get origin() {
          return url.origin;
        },
        get pathname() {
          return url.pathname;
        },
        get search() {
          return url.search;
        },
        assign: vi.fn(),
      };
      const write = (_state: unknown, _title: string, next: string) => {
        url.href = new URL(next, url.href).href;
      };
      return {
        location,
        history: { pushState: vi.fn(write), replaceState: vi.fn(write) },
        refetch: vi.fn(async () => {}),
      };
    })();
    const navigate = extract(
      generateClientEntry(withPlugins),
      "async function navigate(href, action) {",
      "farmNavigateRef.current = navigate;",
      { location, history, refetch, runFarmNavigationDelegates: async () => false, URL },
    )("return navigate;") as (href: string, action: "push" | "replace") => Promise<void>;

    await navigate("/notes/2", "push");
    expect(refetch).toHaveBeenCalledWith("https://app.test/notes/2", {
      action: "push",
      from: "https://app.test/notes?tab=1",
    });
    expect(history.pushState).toHaveBeenCalledWith(null, "", "https://app.test/notes/2");

    // Back and forward are navigations too, from a page the browser already left.
    expect(generateClientEntry(withPlugins)).toContain(
      "const nav = () => refetch(location.href, { action: 'pop', from: null });",
    );
  });

  it("starts hydration hooks around hydrateRoot and reports a failed hydration", () => {
    const entry = generateClientEntry(withPlugins);
    const begin = entry.indexOf("farmClientRuntime.beginHydration({");
    const hydrate = entry.indexOf("hydrateRoot(rootElForHydrate");
    const complete = entry.indexOf("await farmClientRuntime.completeHydration(hydration);");
    expect(begin).toBeGreaterThan(-1);
    expect(hydrate).toBeGreaterThan(begin);
    expect(complete).toBeGreaterThan(hydrate);
    expect(entry).toContain(
      "await farmClientRuntime.failHydration(hydration, error);\n    throw error;",
    );
  });
});
