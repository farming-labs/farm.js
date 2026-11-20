import { describe, expect, it } from "vitest";
import {
  buildSentryBrowserInitOptions,
  createSentryBrowserReporter,
  initSentryBrowserOnce,
  reportSentryBrowserError,
  resolveSentryBrowserPublicConfig,
  resolveSentryBrowserSdk,
  sentryClient,
  type SentryBrowserClientState,
  type SentryBrowserSdkLike,
  type SentryBrowserScopeLike,
} from "./client";
import { sentryPlugin } from "./index";

function createFakeBrowserSdk() {
  const captured: unknown[] = [];
  const tags: Record<string, string> = {};
  const contexts: Record<string, Record<string, unknown> | null> = {};
  const inits: Record<string, unknown>[] = [];
  let client: object | undefined;

  const sdk: SentryBrowserSdkLike = {
    init(options) {
      inits.push(options);
      client = { name: "fake-browser-client" };
    },
    getClient() {
      return client;
    },
    captureException(error) {
      captured.push(error);
      return "event-id";
    },
    withScope(callback) {
      const scope: SentryBrowserScopeLike = {
        setTag(key, value) {
          tags[key] = value;
        },
        setContext(key, value) {
          contexts[key] = value;
        },
      };
      return callback(scope);
    },
  };

  return { sdk, captured, tags, contexts, inits };
}

function browserErrorEvent(overrides: Record<string, unknown> = {}) {
  return {
    error: new Error("boom"),
    phase: "window",
    location: {
      href: "https://example.com/users/42",
      pathname: "/users/42",
      search: "",
      hash: "",
    },
    navigation: {
      id: "nav-1",
      from: null,
      to: {
        href: "https://example.com/users/42",
        pathname: "/users/42",
        search: "",
        hash: "",
      },
      action: "push",
      signal: new AbortController().signal,
      startedAt: 0,
      route: { pattern: "/users/[id]", params: { id: "42" } },
    },
    ...overrides,
  };
}

describe("resolveSentryBrowserPublicConfig", () => {
  it("drops unset keys so public data stays JSON-safe", () => {
    expect(resolveSentryBrowserPublicConfig({ browserDsn: "browser-dsn" })).toEqual({
      browserDsn: "browser-dsn",
      sendDefaultPii: false,
    });
  });

  it("carries the scalar browser options", () => {
    expect(
      resolveSentryBrowserPublicConfig({
        browserDsn: "browser-dsn",
        environment: "staging",
        release: "v1",
        sendDefaultPii: true,
      }),
    ).toEqual({
      browserDsn: "browser-dsn",
      environment: "staging",
      release: "v1",
      sendDefaultPii: true,
    });
  });
});

describe("buildSentryBrowserInitOptions", () => {
  it("initializes from the browser DSN, never the server one", () => {
    expect(
      buildSentryBrowserInitOptions({ browserDsn: "https://key@example.com/2" }),
    ).toMatchObject({ dsn: "https://key@example.com/2", sendDefaultPii: false });
  });

  it("merges sentryOptions, with explicit options winning", () => {
    const built = buildSentryBrowserInitOptions({
      browserDsn: "explicit",
      sentryOptions: { debug: true, dsn: "passthrough" },
    });

    expect(built).toMatchObject({ debug: true, dsn: "explicit" });
  });

  it("does not let an unset option clobber a passthrough key", () => {
    expect(buildSentryBrowserInitOptions({ sentryOptions: { release: "v1" } })).toMatchObject({
      release: "v1",
    });
  });
});

describe("initSentryBrowserOnce", () => {
  it("does not initialize without a browser DSN", () => {
    const fake = createFakeBrowserSdk();

    expect(initSentryBrowserOnce(fake.sdk, {})).toBe(false);
    expect(fake.inits).toHaveLength(0);
  });

  it("does not initialize twice", () => {
    const fake = createFakeBrowserSdk();

    expect(initSentryBrowserOnce(fake.sdk, { browserDsn: "dsn" })).toBe(true);
    expect(initSentryBrowserOnce(fake.sdk, { browserDsn: "dsn" })).toBe(false);
    expect(fake.inits).toHaveLength(1);
  });
});

describe("resolveSentryBrowserSdk", () => {
  it("uses an injected SDK instead of importing one", async () => {
    const fake = createFakeBrowserSdk();

    await expect(resolveSentryBrowserSdk({ sdk: fake.sdk })).resolves.toBe(fake.sdk);
  });

  it("resolves the real @sentry/browser module with the expected shape", async () => {
    const sdk = await resolveSentryBrowserSdk({});

    expect(sdk).toBeDefined();
    expect(typeof sdk?.init).toBe("function");
    expect(typeof sdk?.getClient).toBe("function");
    expect(typeof sdk?.captureException).toBe("function");
    expect(typeof sdk?.withScope).toBe("function");
  });
});

describe("createSentryBrowserReporter", () => {
  it("stays disabled without a browser DSN and never initializes the SDK", async () => {
    const fake = createFakeBrowserSdk();

    const state = await createSentryBrowserReporter({ sdk: fake.sdk });

    expect(state).toEqual({ sdk: undefined, enabled: false });
    expect(fake.inits).toHaveLength(0);
  });

  it("stays disabled when reporting is off, even with a DSN", async () => {
    const fake = createFakeBrowserSdk();

    const state = await createSentryBrowserReporter({
      sdk: fake.sdk,
      browserDsn: "dsn",
      enabled: false,
    });

    expect(state).toEqual({ sdk: undefined, enabled: false });
    expect(fake.inits).toHaveLength(0);
  });

  it("initializes the injected SDK once with the browser DSN", async () => {
    const fake = createFakeBrowserSdk();

    const state = await createSentryBrowserReporter({
      sdk: fake.sdk,
      browserDsn: "browser-dsn",
      environment: "staging",
    });

    expect(state.enabled).toBe(true);
    expect(state.sdk).toBe(fake.sdk);
    expect(fake.inits).toHaveLength(1);
    expect(fake.inits[0]).toMatchObject({ dsn: "browser-dsn", environment: "staging" });
  });
});

describe("reportSentryBrowserError", () => {
  it("captures the error with the Farm phase and page context", () => {
    const fake = createFakeBrowserSdk();
    const state: SentryBrowserClientState = { sdk: fake.sdk, enabled: true };

    reportSentryBrowserError(state, browserErrorEvent());

    expect(fake.captured).toHaveLength(1);
    expect(fake.captured[0]).toBeInstanceOf(Error);
    expect(fake.tags).toEqual({ "farm.phase": "window" });
    expect(fake.contexts.page).toEqual({ path: "/users/42", route: "/users/[id]" });
  });

  it("omits the route when the navigation has no pattern", () => {
    const fake = createFakeBrowserSdk();
    const state: SentryBrowserClientState = { sdk: fake.sdk, enabled: true };
    const event = browserErrorEvent({ navigation: undefined });

    reportSentryBrowserError(state, event);

    expect(fake.contexts.page).toEqual({ path: "/users/42" });
  });

  it("captures without a scope when the SDK does not support one", () => {
    const fake = createFakeBrowserSdk();
    const sdk: SentryBrowserSdkLike = {
      captureException: fake.sdk.captureException,
    };
    const state: SentryBrowserClientState = { sdk, enabled: true };

    reportSentryBrowserError(state, browserErrorEvent());

    expect(fake.captured).toHaveLength(1);
  });

  it("does nothing when disabled or without an SDK", () => {
    const fake = createFakeBrowserSdk();

    reportSentryBrowserError({ sdk: fake.sdk, enabled: false }, browserErrorEvent());
    reportSentryBrowserError({ sdk: undefined, enabled: true }, browserErrorEvent());

    expect(fake.captured).toHaveLength(0);
  });
});

describe("sentryClient", () => {
  it("reports browser errors through the injected SDK", async () => {
    const fake = createFakeBrowserSdk();
    const plugin = sentryClient({ sdk: fake.sdk, browserDsn: "browser-dsn" });
    const state = await plugin.setup?.({} as never);

    expect(state?.enabled).toBe(true);
    plugin.error?.({
      state,
      ...browserErrorEvent(),
    } as never);

    expect(fake.captured).toHaveLength(1);
    expect(fake.tags).toEqual({ "farm.phase": "window" });
  });

  it("registers inert hooks without a browser DSN", async () => {
    const fake = createFakeBrowserSdk();
    const plugin = sentryClient({ sdk: fake.sdk });
    const state = await plugin.setup?.({} as never);

    expect(state).toEqual({ sdk: undefined, enabled: false });
    plugin.error?.({
      state,
      ...browserErrorEvent(),
    } as never);

    expect(fake.captured).toHaveLength(0);
    expect(fake.inits).toHaveLength(0);
  });
});

describe("sentryPlugin browser reporting", () => {
  it("adds a client section only when a browser DSN is configured", () => {
    expect(sentryPlugin({}).client).toBeUndefined();
    expect(sentryPlugin({ dsn: "server-dsn" }).client).toBeUndefined();
    expect(sentryPlugin({ dsn: "server-dsn", browserDsn: "browser-dsn" }).client).toBeDefined();
  });

  it("does not add a client section when reporting is disabled", () => {
    expect(sentryPlugin({ browserDsn: "browser-dsn", enabled: false }).client).toBeUndefined();
  });

  it("never embeds the server DSN in the public browser config", () => {
    const plugin = sentryPlugin({ dsn: "server-secret", browserDsn: "browser-dsn" });

    expect(plugin.client?.public).toEqual({
      browserDsn: "browser-dsn",
      sendDefaultPii: false,
    });
    expect(JSON.stringify(plugin.client?.public)).not.toContain("server-secret");
  });

  it("registers the browser reporter from the public config", () => {
    const plugin = sentryPlugin({ dsn: "server-dsn", browserDsn: "browser-dsn" });
    const client = plugin.client;

    // The inline hooks are serialized into the generated client entry at
    // build time; their self-containment (literal dynamic import, no free
    // variables) is verified against the built output in the batch log, not
    // here — the test runner rewrites dynamic imports, so asserting on the
    // runtime function source would be transform-dependent.
    expect(client).toBeDefined();
    expect(typeof client?.setup).toBe("function");
    expect(typeof client?.error).toBe("function");
  });
});
