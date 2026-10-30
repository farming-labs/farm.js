import { createHmac, timingSafeEqual } from "node:crypto";
import { definePlugin } from "@farm.js/core";

/**
 * Locks the embedded Farm server to the desktop window that started it.
 *
 * The Electrobun shell (desktop/main.ts) starts the server on a random
 * 127.0.0.1 port with a fresh FARM_DESKTOP_SECRET, then opens the window at
 * `/__desktop/handshake?token=<secret>`. The handshake swaps the token for an
 * HttpOnly, SameSite=Strict session cookie and redirects to `/`. Every other
 * request must carry that cookie, so another local process or a web page in
 * the user's browser cannot call the app's pages, API routes, or actions.
 *
 * The Host check rejects DNS rebinding: a page on evil.example that resolves
 * to 127.0.0.1 still sends `Host: evil.example:<port>`.
 *
 * With no FARM_DESKTOP_SECRET (plain `farm dev` in a browser), the guard is off.
 */
export const DESKTOP_HANDSHAKE_PATH = "/__desktop/handshake";
const SESSION_COOKIE = "farm_desktop_session";
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::(\d{1,5}))?$/i;

function secret(): string {
  return process.env.FARM_DESKTOP_SECRET ?? "";
}

// Derived from the per-launch secret, so it is stable across dev reloads of
// this module and changes on every app launch.
function sessionValue(launchSecret: string): string {
  return createHmac("sha256", launchSecret).update("farm-desktop-session").digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function hostAllowed(request: Request): boolean {
  const match = LOOPBACK_HOST.exec(request.headers.get("host") ?? "");
  if (!match) return false;
  const expectedPort = process.env.FARM_DESKTOP_PORT;
  return !expectedPort || match[1] === expectedPort;
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index !== -1 && part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return undefined;
}

function forbidden(reason: string): Response {
  return new Response(`Forbidden: ${reason}\n`, {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export function desktopGuard() {
  return definePlugin({
    name: "example:desktop-guard",
    runtime: {
      endpoints: [
        {
          path: DESKTOP_HANDSHAKE_PATH,
          handler({ request }) {
            const launchSecret = secret();
            if (!launchSecret) return new Response("Not found\n", { status: 404 });
            // Endpoints skip runtime.before, so check the host here as well.
            if (!hostAllowed(request)) return forbidden("unexpected host");

            const token = new URL(request.url).searchParams.get("token") ?? "";
            if (!safeEqual(token, launchSecret)) return forbidden("bad handshake token");

            return new Response(null, {
              status: 303,
              headers: {
                location: "/",
                "set-cookie": `${SESSION_COOKIE}=${sessionValue(launchSecret)}; Path=/; HttpOnly; SameSite=Strict`,
                "cache-control": "no-store",
                "referrer-policy": "no-referrer",
              },
            });
          },
        },
      ],
      before({ request }) {
        const launchSecret = secret();
        if (!launchSecret) return;
        if (!hostAllowed(request)) return forbidden("unexpected host");

        const session = readCookie(request, SESSION_COOKIE) ?? "";
        if (!safeEqual(session, sessionValue(launchSecret))) {
          return forbidden("this app only answers its desktop window");
        }
      },
    },
  });
}
