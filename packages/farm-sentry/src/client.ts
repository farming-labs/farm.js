"use client";

import type { FarmClientPlugin, FarmClientPluginErrorEvent } from "@farm.js/core/plugin/client";

/** Minimal scope surface used by the client reporter, satisfied by `@sentry/browser`. */
export interface SentryBrowserScopeLike {
  setTag(key: string, value: string): void;
  setContext(key: string, value: Record<string, unknown> | null): void;
}

/**
 * The parts of the Sentry browser SDK this client uses. Declared structurally
 * so the client can be unit tested and so an application can pass an SDK it
 * already initialized, the way the server plugin accepts any SDK module.
 */
export interface SentryBrowserSdkLike {
  init?(options: Record<string, unknown>): void;
  /** Returns the active client, or undefined before `init`. */
  getClient?(): unknown;
  captureException(error: unknown, hint?: { captureContext?: unknown }): string;
  withScope?<T>(callback: (scope: SentryBrowserScopeLike) => T): T;
}

export interface SentryBrowserClientOptions {
  /**
   * Browser project DSN. Must be provided explicitly — never reuse the server
   * DSN: a browser DSN is public by design, a server DSN is a secret.
   */
  browserDsn?: string;
  environment?: string;
  release?: string;
  /**
   * Error events can carry page URLs and user data, so this stays off unless
   * the application opts in.
   */
  sendDefaultPii?: boolean;
  /** An SDK module to use instead of importing `@sentry/browser`. */
  sdk?: SentryBrowserSdkLike;
  /** Set false to register the hooks but do no reporting. */
  enabled?: boolean;
  /**
   * Extra options merged into `Sentry.init`, for anything this client does not
   * model directly such as `debug`, `beforeSend` or `ignoreErrors`. Explicit
   * options above win over keys repeated here.
   */
  sentryOptions?: Record<string, unknown>;
}

/**
 * JSON-safe public config embedded in the browser bundle by the server
 * plugin. It carries only the browser DSN and scalar options — never the
 * server DSN or any other server value.
 */
export interface SentryBrowserClientPublic {
  browserDsn?: string;
  environment?: string;
  release?: string;
  sendDefaultPii?: boolean;
}

export interface SentryBrowserClientState {
  sdk?: SentryBrowserSdkLike;
  enabled: boolean;
}

const MISSING_BROWSER_SDK_MESSAGE =
  "@farm.js/sentry needs @sentry/browser for browser reporting. Install it with " +
  "`pnpm add @sentry/browser`, or pass an SDK through the `sdk` option.";

/**
 * Build the public config the server plugin embeds in the browser bundle.
 * Undefined keys are dropped: the client-plugin build rejects `undefined`
 * values in public data, and a missing key must not clobber anything.
 */
export function resolveSentryBrowserPublicConfig(
  options: Pick<
    SentryBrowserClientOptions,
    "browserDsn" | "environment" | "release" | "sendDefaultPii"
  >,
): SentryBrowserClientPublic {
  const config: SentryBrowserClientPublic = {
    browserDsn: options.browserDsn,
    environment: options.environment,
    release: options.release,
    sendDefaultPii: options.sendDefaultPii ?? false,
  };

  // Drop undefined so the config only carries what the application set.
  for (const key of Object.keys(config) as (keyof SentryBrowserClientPublic)[]) {
    if (config[key] === undefined) delete config[key];
  }

  return config;
}

export function buildSentryBrowserInitOptions(
  options: SentryBrowserClientOptions,
): Record<string, unknown> {
  const explicit: Record<string, unknown> = {
    dsn: options.browserDsn,
    environment: options.environment,
    release: options.release,
    sendDefaultPii: options.sendDefaultPii ?? false,
  };

  // Drop undefined so a passthrough key is not overwritten by an unset option.
  for (const key of Object.keys(explicit)) {
    if (explicit[key] === undefined) delete explicit[key];
  }

  return { ...options.sentryOptions, ...explicit };
}

export async function resolveSentryBrowserSdk(
  options: SentryBrowserClientOptions,
): Promise<SentryBrowserSdkLike | undefined> {
  if (options.sdk) return options.sdk;

  try {
    // The specifier has to be a literal. A variable is invisible to bundlers,
    // so the dependency is never traced into the browser output and the import
    // fails at runtime.
    return (await import("@sentry/browser")) as unknown as SentryBrowserSdkLike;
  } catch {
    return undefined;
  }
}

/**
 * Report loudly when a browser DSN was configured but no SDK resolved.
 * Silently doing nothing hides a missing or broken install until errors are
 * already lost. This logs rather than throws: monitoring must never take the
 * application down with it.
 */
export function assertSentryBrowserSdk(
  sdk: SentryBrowserSdkLike | undefined,
  options: SentryBrowserClientOptions,
): SentryBrowserSdkLike | undefined {
  if (sdk) return sdk;
  if (options.browserDsn) console.error(`[farm:sentry] ${MISSING_BROWSER_SDK_MESSAGE}`);
  return undefined;
}

export async function requireSentryBrowserSdk(
  options: SentryBrowserClientOptions,
): Promise<SentryBrowserSdkLike | undefined> {
  return assertSentryBrowserSdk(await resolveSentryBrowserSdk(options), options);
}

/** Initialize once. A second `init` would replace a working client. */
export function initSentryBrowserOnce(
  sdk: SentryBrowserSdkLike,
  options: SentryBrowserClientOptions,
): boolean {
  if (!options.browserDsn) return false;
  if (sdk.getClient?.()) return false;
  sdk.init?.(buildSentryBrowserInitOptions(options));
  return true;
}

/**
 * Resolve the browser SDK and initialize it, unless browser reporting is
 * disabled or no browser DSN was provided. The SDK module is not imported at
 * all without a DSN, so `@sentry/browser` stays out of the browser bundle
 * unless the application opts in.
 */
export async function createSentryBrowserReporter(
  options: SentryBrowserClientOptions = {},
): Promise<SentryBrowserClientState> {
  const disabled: SentryBrowserClientState = { sdk: undefined, enabled: false };
  if (options.enabled === false) return disabled;
  if (!options.browserDsn) return disabled;

  try {
    const sdk = await requireSentryBrowserSdk(options);
    if (!sdk) return disabled;

    initSentryBrowserOnce(sdk, options);
    return { sdk, enabled: true };
  } catch (error) {
    // Browser startup must not fail because reporting could not start.
    console.error(
      "[farm:sentry] failed to initialize browser reporting, continuing without it:",
      error,
    );
    return disabled;
  }
}

/**
 * Forward one client error event to the browser SDK, tagged with the Farm
 * error phase and the page it happened on. The core client plugin manager
 * already reports each error object once, so no extra dedupe is needed here.
 */
export function reportSentryBrowserError(
  state: SentryBrowserClientState,
  event: Pick<FarmClientPluginErrorEvent, "error" | "phase" | "location" | "navigation">,
): void {
  if (!state.enabled || !state.sdk) return;

  const capture = () => state.sdk?.captureException(event.error);

  if (state.sdk.withScope) {
    state.sdk.withScope((scope) => {
      scope.setTag("farm.phase", event.phase);
      const context: Record<string, unknown> = { path: event.location.pathname };
      const route = event.navigation?.route?.pattern;
      if (route) context.route = route;
      scope.setContext("page", context);
      capture();
    });
    return;
  }

  capture();
}

/**
 * Register browser error reporting from the app client entry (`src/client.ts`),
 * where an SDK the application already initialized can travel because the
 * module is bundled with the app instead of crossing the server-plugin
 * boundary:
 *
 * ```ts
 * // src/client.ts
 * import { defineClient } from "@farm.js/core/client";
 * import { sentryClient } from "@farm.js/sentry/client";
 *
 * export default defineClient(
 *   sentryClient({ browserDsn: import.meta.env.PUBLIC_SENTRY_DSN }),
 * );
 * ```
 *
 * Prefer the `sentryPlugin` server plugin when only the `browserDsn` option
 * is needed; use this only for an injected `sdk` or when the app already owns
 * a client entry and wants the reporter beside its own hooks.
 */
export function sentryClient(
  options: SentryBrowserClientOptions = {},
): FarmClientPlugin<SentryBrowserClientState, SentryBrowserClientPublic> {
  return {
    async setup() {
      return createSentryBrowserReporter(options);
    },
    error(event) {
      reportSentryBrowserError(event.state, event);
    },
  };
}
