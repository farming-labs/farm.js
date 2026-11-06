/**
 * `@farm.js/auth/client` for React Native screens (`page.native.tsx`). Metro resolves this file
 * through the `react-native` export condition; web builds never see it, so web bundles do not
 * change. It has the web client's exports and types, and calls the same auth routes through
 * `serverFetch` from `@farm.js/native`, which sends the device's session token. Sign-in and
 * sign-up go through the shell's native code, which keeps the session cookie in the WebView and
 * issues the device token from it.
 */
import { useSyncExternalStore } from "react";
import { serverFetch, signOut as forgetDevice } from "@farm.js/native";
import { shellSignIn } from "@farm.js/native/internal";
import { normalizeBasePath } from "./config.js";
import type * as web from "./client.js";
import type { FarmAuthClientOptions, FarmAuthCredentials, FarmAuthSignUpInput } from "./types.js";

type WebClient = ReturnType<typeof web.createFarmAuthClient>;
type WebAuth = ReturnType<WebClient["useAuth"]>;
type SessionResult = Awaited<ReturnType<WebClient["getSession"]>>;
type SessionData = NonNullable<SessionResult["data"]>;
type SignOutResult = Awaited<ReturnType<WebClient["signOut"]>>;
type AuthError = NonNullable<SessionResult["error"]>;
type RefetchOptions = Parameters<WebAuth["refetch"]>[0];
type SignInResult = Awaited<ReturnType<WebClient["signIn"]>>;
type SignUpResult = Awaited<ReturnType<WebClient["signUp"]>>;
type Result<T> = { data: T; error: null } | { data: null; error: AuthError };

interface SessionState {
  data: SessionData | null;
  error: WebAuth["error"];
  isPending: boolean;
  isRefetching: boolean;
}

const SOCIAL_SIGN_IN_UNSUPPORTED =
  "@farm.js/auth/client: social and OAuth sign-in need a browser session and are not supported " +
  "on native screens yet. Sign in with email and password, or on a web screen.";

// The ISO timestamps Better Auth's client turns into Dates, so `createdAt` and `expiresAt` are
// Dates here as on the web.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/;

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text, (key, value: unknown) => {
      if (key === "__proto__") return undefined;
      if (typeof value === "string" && ISO_DATE.test(value)) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date;
      }
      return value;
    });
  } catch {
    return text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Same options as the web client. `basePath` must match `auth.basePath` and, like every
 * `serverFetch` path, sits under the app's base path on `mobile.server`. `baseURL` does not apply:
 * native screens always call `mobile.server`, the only origin the device token is sent to.
 */
export const createFarmAuthClient: typeof web.createFarmAuthClient = (
  options: FarmAuthClientOptions = {},
) => {
  const basePath = normalizeBasePath(options.basePath);

  // The status-and-body result Better Auth's client returns.
  function toResult<T>(status: number, statusText: string, text: string): Result<T> {
    const body = parseBody(text);
    if (status >= 200 && status < 300) return { data: (body ?? null) as T, error: null };
    return {
      data: null,
      error: { ...(isRecord(body) ? body : {}), status, statusText },
    };
  }

  // From `serverFetch`. Async, so a screen that is not rendered yet (no `mobile.server`) rejects
  // instead of throwing.
  async function request<T>(route: string, init: RequestInit): Promise<Result<T>> {
    const response = await serverFetch(`${basePath}${route}`, init);
    return toResult<T>(response.status, response.statusText, await response.text());
  }

  async function loadSession(query?: Record<string, unknown>): Promise<SessionResult> {
    const search = Object.entries(query ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join("&");
    const result = await request<SessionData | null>(`/get-session${search ? `?${search}` : ""}`, {
      method: "GET",
    });
    // A 401 here means the device has no valid token: signed out, as the web client reports it.
    if (result.error?.status === 401) return { data: null, error: null };
    return result;
  }

  const signedOut: SessionState = {
    data: null,
    error: null,
    isPending: false,
    isRefetching: false,
  };
  let state: SessionState = { ...signedOut, isPending: true };
  let latest = 0;
  const listeners = new Set<() => void>();

  function setState(next: SessionState) {
    state = next;
    for (const listener of listeners) listener();
  }

  // Better Auth's useSession states, in the same order: pending until the first answer, a 401
  // clears the user, a thrown error keeps the last one.
  async function refetch(queryParams?: RefetchOptions): Promise<void> {
    const id = ++latest;
    setState({ ...state, isPending: state.data === null, error: null, isRefetching: true });
    try {
      const result = await loadSession(queryParams?.query);
      if (id !== latest) return;
      setState(
        result.error
          ? { ...signedOut, data: state.data, error: result.error as WebAuth["error"] }
          : { ...signedOut, data: result.data },
      );
    } catch (error) {
      if (id !== latest) return;
      setState({ ...signedOut, data: state.data, error: error as WebAuth["error"] });
    }
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    // The first mounted hook loads the session, after React has subscribed.
    if (listeners.size === 1) void Promise.resolve().then(() => refetch());
    return () => {
      listeners.delete(listener);
    };
  }

  const getState = () => state;

  /**
   * The web client's route and body, sent by the shell's native code. On success the WebView has
   * the session cookie (web screens are signed in too), the device has its token, and `useAuth`
   * has the user before this resolves. The shell never returns cookies or tokens to JS; the body
   * is Better Auth's, as the web client gets it.
   */
  async function credentials<T>(route: string, input: object): Promise<Result<T>> {
    if ("provider" in input) throw new Error(SOCIAL_SIGN_IN_UNSUPPORTED);
    const reply = await shellSignIn(`${basePath}${route}`, input);
    // The shell has no reason phrase to pass on; HTTP/2 responses on the web have none either.
    const result = toResult<T>(reply.status, "", reply.body);
    if (result.error === null) await refetch();
    return result;
  }

  function signIn(input: FarmAuthCredentials): Promise<SignInResult> {
    return credentials<NonNullable<SignInResult["data"]>>(
      "/sign-in/email",
      input,
    ) as Promise<SignInResult>;
  }

  function signUp(input: FarmAuthSignUpInput): Promise<SignUpResult> {
    return credentials<NonNullable<SignUpResult["data"]>>(
      "/sign-up/email",
      input,
    ) as Promise<SignUpResult>;
  }

  /**
   * End the server session, then forget this device: revoke its token, delete it from the
   * Keystore or Keychain, and clear the WebView's cookies. The device step runs even when the
   * server call fails or the phone is offline; the server's error is still returned or thrown.
   */
  async function signOut(): Promise<SignOutResult> {
    let result: SignOutResult | undefined;
    let failure: unknown;
    let failed = false;
    try {
      result = await request<NonNullable<SignOutResult["data"]>>("/sign-out", { method: "POST" });
    } catch (error) {
      failed = true;
      failure = error;
    }
    try {
      await forgetDevice();
    } catch (error) {
      if (!failed) throw error;
    } finally {
      latest += 1;
      setState(signedOut);
    }
    if (failed) throw failure;
    return result!;
  }

  function getSession(): Promise<SessionResult> {
    return loadSession();
  }

  function useAuth(): WebAuth {
    const current = useSyncExternalStore(subscribe, getState, getState);
    return {
      user: current.data?.user ?? null,
      session: current.data?.session ?? null,
      isPending: current.isPending,
      isRefetching: current.isRefetching,
      error: current.error,
      refetch,
      signIn,
      signUp,
      signOut,
    };
  }

  return { signIn, signUp, signOut, getSession, useAuth };
};

const defaultClient = createFarmAuthClient();

export const { getSession, signIn, signOut, signUp, useAuth } = defaultClient;

export type { FarmAuthClientOptions, FarmAuthCredentials, FarmAuthSignUpInput } from "./types.js";
