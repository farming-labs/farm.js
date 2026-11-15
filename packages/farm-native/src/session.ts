/**
 * Signed-in server calls from native screens (RFC 0004, 7.14). The shell owns the tokens: it
 * trades the WebView's cookie session for a device token after a sign-in on any screen, keeps
 * it in the Android Keystore or the iOS Keychain, and refreshes it. JS sees only the short-lived
 * access token, never the refresh token.
 */

/** The session part of the shell's `FarmShell` module. */
export interface FarmShellSession {
  /** The app's `mobile.id`, and the current access token or null while signed out. */
  session(): Promise<{ appId: string; accessToken: string | null } | null>;
  /**
   * A new access token after `failedToken` was rejected, or null when the device is signed out
   * (the shell has deleted its tokens then). Concurrent calls share one refresh.
   */
  refreshSession(failedToken: string): Promise<string | null>;
  /** Revoke the device token on the server and delete it, and the WebView's cookies, here. */
  signOut(): Promise<void>;
}

export const FARM_MOBILE_APP_HEADER = "x-farm-mobile";

/** Bodies `fetch` can send twice. A stream is read by the first attempt. */
function isReplayable(body: unknown): boolean {
  return (
    body === undefined ||
    body === null ||
    typeof body === "string" ||
    body instanceof URLSearchParams ||
    (typeof FormData !== "undefined" && body instanceof FormData) ||
    (typeof Blob !== "undefined" && body instanceof Blob) ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  );
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * `fetch(url, init)` with the device's session when `url` is on `server`: `Authorization:
 * Bearer` and `X-Farm-Mobile`. On a 401 it asks the shell to refresh once and retries with the new
 * token. The token never goes to another origin.
 */
export async function fetchWithFarmSession(
  url: string,
  init: RequestInit | undefined,
  options: {
    server: string;
    shell: FarmShellSession | undefined;
    fetch?: typeof fetch;
  },
): Promise<Response> {
  const send = options.fetch ?? fetch;
  const headers = new Headers(init?.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  const shell = options.shell;
  const sameServer = originOf(url) !== null && originOf(url) === originOf(options.server);
  const session = shell && sameServer ? await shell.session() : null;
  if (!session) return send(url, { ...init, headers });

  headers.set(FARM_MOBILE_APP_HEADER, session.appId);
  // The caller's own Authorization (an API key, say) wins.
  if (!session.accessToken || headers.has("authorization")) return send(url, { ...init, headers });
  headers.set("authorization", `Bearer ${session.accessToken}`);
  const response = await send(url, { ...init, headers });
  if (response.status !== 401 || !isReplayable(init?.body)) return response;

  const next = await shell!.refreshSession(session.accessToken);
  if (!next) return response;
  await response.body?.cancel().catch(() => {});
  headers.set("authorization", `Bearer ${next}`);
  return send(url, { ...init, headers });
}
