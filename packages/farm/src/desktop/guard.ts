import { parseRequestCookieHeader } from "../request-cookies";
import { farmSecretsMatch } from "../secret-compare";

/**
 * The local guard for `farm dev --desktop` and `farm build --desktop`.
 *
 * A desktop app's Farm server listens on 127.0.0.1, where every local process and every page in
 * the user's browser can reach it. The shell starts the server with a per-launch `secret` and a
 * one-time `handshakeToken`, then opens its window at the handshake URL. The handshake consumes
 * the token, sets the secret as an HttpOnly, SameSite=Strict cookie, and redirects to the app.
 * Every other request needs that cookie, so only the app's own window gets an answer.
 *
 * Requests must also name a loopback Host on the server's port (DNS rebinding sends the
 * attacker's host name), must not be cross-site or same-site according to Fetch Metadata
 * (cookies ignore ports, so a page on another localhost port is "same-site" and would carry the
 * cookie), and unsafe methods with an Origin must come from the server's own origin.
 *
 * Only desktop builds and `farm dev --desktop` load this module.
 */

export const FARM_DESKTOP_HANDSHAKE_PATH = "/__farm/desktop/handshake";
export const FARM_DESKTOP_COOKIE = "farm_desktop";
/** The handshake URL carries the one-time token in this query parameter. */
export const FARM_DESKTOP_HANDSHAKE_PARAM = "t";

/** Shortest accepted secret or token: 32 random bytes encode to 43 base64url characters. */
export const FARM_DESKTOP_MIN_SECRET_LENGTH = 32;

/** The parts of a request the guard reads. A Web `Request` satisfies it. */
export interface FarmDesktopGuardRequest {
  method: string;
  /** Absolute URL, or the path and query of the request target. */
  url: string;
  headers: { get(name: string): string | null };
}

export interface FarmDesktopGuardOptions {
  /** Per-launch secret, sent back by the window as the session cookie. */
  secret: string;
  /** One-time token the window presents at the handshake URL. */
  handshakeToken: string;
  /** The app's basePath. The handshake lives under it. */
  basePath?: string;
  /** The port the server listens on. Read per request, since port 0 is bound after start. */
  port: () => number | undefined;
  /**
   * Where the guard records that the handshake token was used. Pass an object that outlives the
   * guard (the dev session, which survives Vite restarts) so a rebuilt guard keeps it used.
   */
  handshakeState?: { handshakeUsed?: boolean };
}

export type FarmDesktopGuard = (request: FarmDesktopGuardRequest) => Response | undefined;

const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})$/i;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function forbidden(reason: string): Response {
  return new Response(`Forbidden: ${reason}\n`, {
    status: 403,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-farm-desktop-guard": reason,
    },
  });
}

function assertSecret(value: unknown, name: string): asserts value is string {
  // base64url only, so the secret is a valid cookie value as is.
  if (
    typeof value !== "string" ||
    value.length < FARM_DESKTOP_MIN_SECRET_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new TypeError(
      `[Farm] The desktop ${name} must be a random base64url string of at least ${FARM_DESKTOP_MIN_SECRET_LENGTH} characters.`,
    );
  }
}

/** Path and query of a request target, without parsing an absolute URL more than once. */
function splitTarget(url: string): { pathname: string; search: string } {
  let target = url;
  if (!target.startsWith("/")) {
    try {
      const parsed = new URL(target);
      return { pathname: parsed.pathname, search: parsed.search };
    } catch {
      return { pathname: "", search: "" };
    }
  }
  const hash = target.indexOf("#");
  if (hash !== -1) target = target.slice(0, hash);
  const query = target.indexOf("?");
  return query === -1
    ? { pathname: target, search: "" }
    : { pathname: target.slice(0, query), search: target.slice(query) };
}

function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath || basePath === "/") return "";
  return `/${basePath.replace(/^\/+|\/+$/g, "")}`;
}

export function createFarmDesktopGuard(options: FarmDesktopGuardOptions): FarmDesktopGuard {
  assertSecret(options.secret, "secret");
  assertSecret(options.handshakeToken, "handshake token");
  if (options.secret === options.handshakeToken) {
    throw new TypeError("[Farm] The desktop secret and handshake token must be different values.");
  }
  const { secret, handshakeToken } = options;
  const handshakeState = options.handshakeState ?? {};
  const basePath = normalizeBasePath(options.basePath);
  const handshakePath = `${basePath}${FARM_DESKTOP_HANDSHAKE_PATH}`;
  const home = `${basePath}/`;

  return function farmDesktopGuard(request) {
    const host = request.headers.get("host") ?? "";
    const hostMatch = LOOPBACK_HOST.exec(host);
    const port = options.port();
    if (!hostMatch || port === undefined || Number(hostMatch[1]) !== port) {
      return forbidden("unexpected host");
    }

    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
      return forbidden("cross-site request");
    }

    const method = request.method.toUpperCase();
    const origin = request.headers.get("origin");
    if (origin !== null && !SAFE_METHODS.has(method) && origin !== `http://${host.toLowerCase()}`) {
      return forbidden("cross-origin request");
    }

    const { pathname, search } = splitTarget(request.url);
    if (pathname === handshakePath) {
      if (method !== "GET") return forbidden("handshake must be a GET");
      const token = new URLSearchParams(search).get(FARM_DESKTOP_HANDSHAKE_PARAM) ?? "";
      if (handshakeState.handshakeUsed || !farmSecretsMatch(token, handshakeToken)) {
        return forbidden("invalid or used handshake token");
      }
      // One use: a token copied from a log or a process listing opens nothing later.
      handshakeState.handshakeUsed = true;
      return new Response(null, {
        status: 303,
        headers: {
          location: home,
          "set-cookie": `${FARM_DESKTOP_COOKIE}=${secret}; Path=/; HttpOnly; SameSite=Strict`,
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
      });
    }

    // Duplicate names are possible (another app on 127.0.0.1 can set one); accept a match.
    for (const cookie of parseRequestCookieHeader(request.headers.get("cookie"))) {
      if (cookie.name === FARM_DESKTOP_COOKIE && farmSecretsMatch(cookie.value, secret)) {
        return undefined;
      }
    }
    return forbidden("this app only answers its own desktop window");
  };
}
