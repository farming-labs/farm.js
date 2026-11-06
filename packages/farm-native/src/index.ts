/**
 * `@farm.js/native`: hooks for React Native screens (`page.native.tsx`, `page.android.tsx`,
 * `page.ios.tsx`) in a Farm mobile app. Screens navigate by URL through the shell's navigator and
 * read data from `mobile.server` over HTTP, like the app's web pages.
 */
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { resolveFarmHref, type FarmRouteParams } from "./routes";
import { farmApp, FarmScreenContext, farmShell, type FarmScreenState } from "./runtime";
import { fetchWithFarmSession, type FarmShellSession } from "./session";

export { matchFarmRoute, resolveFarmHref } from "./routes";
export type { FarmRouteMatchOptions, FarmRouteParams } from "./routes";
export type { FarmShellSession } from "./session";

function useScreen(hook: string): FarmScreenState {
  const screen = useContext(FarmScreenContext);
  if (!screen) {
    throw new Error(`${hook}() works only in a Farm native screen (page.native.tsx).`);
  }
  return screen;
}

export interface FarmNavigateOptions {
  /** Replace the current screen instead of pushing (route rules may still present it). */
  replace?: boolean;
}

export type FarmNavigate = (href: string, options?: FarmNavigateOptions) => void;

/**
 * Navigate by URL, like a link in a web page. The shell's navigator picks the next screen from
 * `farm-routes.json` (web or native, push, modal, tab), so a native screen never names another
 * component. `/notes/7` is an app path (the base path is added); other origins open outside.
 */
export function useNavigate(): FarmNavigate {
  return useScreenNavigate(useScreen("useNavigate"));
}

/** Not a public API: `navigate` for `@farm.js/ui` components, which may render outside a screen. */
export function _useNavigateInScreen(): FarmNavigate {
  return useScreenNavigate(useContext(FarmScreenContext));
}

function useScreenNavigate(screen: FarmScreenState | null): FarmNavigate {
  return useCallback(
    (href: string, options?: FarmNavigateOptions) => {
      if (!screen)
        throw new Error("Navigation works only in a Farm native screen (page.native.tsx).");
      const path =
        href.startsWith("/") && !href.startsWith("//") ? `${screen.basePath}${href}` : href;
      const url = resolveFarmHref(path, screen.url);
      const shell = farmShell();
      if (!shell) throw new Error("The Farm shell's navigator is not in this app.");
      shell.visit(screen.screen, url, options?.replace === true);
    },
    [screen],
  );
}

/** The route params of this screen, such as `{ id: "7" }` for `/notes/[id]`. */
export function useRouteParams<TParams extends FarmRouteParams = FarmRouteParams>(): TParams {
  return useScreen("useRouteParams").params as TParams;
}

/** The absolute URL of a path on `mobile.server`, with the app's base path. */
export function serverUrl(path: string): string {
  if (!farmApp.server) throw new Error("serverUrl() is available once a native screen renders.");
  if (/^[a-z][a-z\d+.-]*:/i.test(path)) return path;
  return `${farmApp.server.replace(/\/$/, "")}${farmApp.basePath}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** The shell's session methods, when this shell has them. */
function shellSession(): FarmShellSession | undefined {
  const shell = farmShell();
  return shell && typeof shell.session === "function" && typeof shell.refreshSession === "function"
    ? (shell as FarmShellSession)
    : undefined;
}

/**
 * `fetch` against `mobile.server` (the dev server under `farm dev --mobile`): the same HTTP
 * routes the web client calls, such as `serverFetch("/api/notes")`. Once the user signed in, on a
 * web or a native screen, it sends the device's session (`Authorization: Bearer`), so protected
 * API routes and server functions see the same user; a 401 refreshes the token once and retries.
 */
export function serverFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetchWithFarmSession(serverUrl(path), init, {
    server: farmApp.server,
    shell: shellSession(),
  });
}

/**
 * Forget this device, the low-level half of signing out: the shell revokes its token on the server
 * and deletes it, and clears the server's cookies in the WebView. It does not end the server
 * session: with `@farm.js/auth`, `signOut()` from `@farm.js/auth/client` ends it and then calls
 * this; with another auth, call its sign-out route with `serverFetch` first.
 */
export async function signOut(): Promise<void> {
  await shellSession()?.signOut();
}

/** An async call, such as `() => serverFetch("/api/notes").then((r) => r.json())`. */
export type FarmServerCall<TInput, TData> = (input: TInput) => Promise<TData>;

export interface UseServerQueryOptions {
  /** Skip the call while false. Defaults to true. */
  enabled?: boolean;
}

export interface UseServerQueryResult<TData> {
  data: TData | undefined;
  error: Error | null;
  /** True while the first result for this input is loading. */
  pending: boolean;
  refetch: () => Promise<TData>;
}

interface Entry {
  data?: unknown;
  error?: Error;
  promise?: Promise<unknown>;
}

// Shared by every native screen in the runtime, so a reopened screen shows its last result at
// once and refreshes it.
const cache = new WeakMap<Function, Map<string, Entry>>();

function entryFor(fn: Function, key: string): Entry {
  let entries = cache.get(fn);
  if (!entries) cache.set(fn, (entries = new Map()));
  let entry = entries.get(key);
  if (!entry) entries.set(key, (entry = {}));
  return entry;
}

function stableKey(input: unknown): string {
  return (
    JSON.stringify(input, (_key, value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1)),
          )
        : value,
    ) ?? "undefined"
  );
}

/**
 * Call an async function (such as one that uses `serverFetch`) with `input` when the screen mounts
 * or the input changes, and re-render with its result. Results are shared across screens by
 * function and input. Farm server functions by reference are not wired to native screens yet.
 */
export function useServerQuery<TInput, TData>(
  fn: FarmServerCall<TInput, TData>,
  input: TInput,
  options: UseServerQueryOptions = {},
): UseServerQueryResult<TData> {
  const key = stableKey(input);
  const entry = entryFor(fn, key);
  const [, setVersion] = useState(0);
  const inputRef = useRef(input);
  inputRef.current = input;
  const enabled = options.enabled !== false;

  const run = useCallback((): Promise<TData> => {
    const current = entryFor(fn, key);
    const promise = fn(inputRef.current).then(
      (data) => {
        if (current.promise === promise) {
          current.data = data;
          current.error = undefined;
          current.promise = undefined;
        }
        return data;
      },
      (error: unknown) => {
        if (current.promise === promise) {
          current.error = error instanceof Error ? error : new Error(String(error));
          current.promise = undefined;
        }
        throw error;
      },
    );
    current.promise = promise;
    return promise;
  }, [fn, key]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const rerender = () => {
      if (active) setVersion((version) => version + 1);
    };
    const pending = entryFor(fn, key).promise ?? run();
    pending.then(rerender, rerender);
    return () => {
      active = false;
    };
  }, [enabled, fn, key, run]);

  return {
    data: entry.data as TData | undefined,
    error: entry.error ?? null,
    pending: enabled && !("data" in entry) && entry.error === undefined,
    refetch: () => run().finally(() => setVersion((version) => version + 1)),
  };
}
