import type { ConvexKnownComponent } from "./types.js";

/**
 * Defaults for well-known Convex components, as data: Farm needs no code or dependencies from them.
 * Paths match what each component registers by default in convex/http.ts.
 */
export const KNOWN_COMPONENTS: Readonly<Record<string, ConvexKnownComponent>> = {
  "@convex-dev/better-auth": {
    name: "better-auth",
    service: "auth",
    routes: [{ path: "/api/auth/[...auth]" }],
    siteToken: { path: "/api/auth/convex/token", cookie: "session_token=" },
    tokenPath: "/api/auth/convex/token",
  },
  "@convex-dev/workos-authkit": {
    name: "workos-authkit",
    service: "auth",
    webhook: { path: "/api/webhooks/workos", convexPath: "/workos/webhook" },
  },
  "@convex-dev/polar": {
    name: "polar",
    service: "billing",
    webhook: { path: "/api/webhooks/polar", convexPath: "/polar/events" },
  },
  "@convex-dev/stripe": {
    name: "stripe",
    service: "billing",
    webhook: { path: "/api/webhooks/stripe", convexPath: "/stripe/webhook" },
  },
  "@useautumn/convex": { name: "autumn", service: "billing" },
  "@convex-dev/resend": {
    name: "resend",
    webhook: { path: "/api/webhooks/resend", convexPath: "/resend-webhook" },
  },
};
