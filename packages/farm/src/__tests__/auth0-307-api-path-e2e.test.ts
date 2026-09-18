// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startDevServer } from "../server/create-server";

// End-to-end reproduction of the production-likely trigger: a mutating
// `fetch` to a protected API route (PATCH /api/profile) issued after the
// session expired. The Auth0 integration middleware runs in the integration
// `beforeRequest` hook ahead of the API route dispatcher, so it must redirect
// to the GET-only login route with a status that mandates a GET (303 See Other).
// A 307 would preserve PATCH all the way to the GET-only login route, skip it
// on method, and bypass the Auth0 login flow.
describe("auth0 protected API route redirect (full dev server)", () => {
  it("redirects an unauthenticated PATCH to a protected API route with 303 and reaches /authorize", async () => {
    const packageRoot = process.cwd();
    const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-auth0-307-api-"));
    try {
      await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
      await fs.symlink(
        packageRoot,
        path.join(root, "node_modules", "@farm.js", "core"),
        "junction",
      );
      await fs.symlink(
        path.resolve(packageRoot, "../../packages/farm-auth0"),
        path.join(root, "node_modules", "@farm.js", "auth0"),
        "junction",
      );
      await fs.mkdir(path.join(root, "src", "app", "api", "profile"), { recursive: true });
      await fs.writeFile(path.join(root, "package.json"), '{"type":"module"}');
      await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `export default function Page() { return null; }\n`,
      );
      await fs.writeFile(
        path.join(root, "src", "app", "api", "profile", "route.ts"),
        `export async function PATCH() { return Response.json({ ok: true }); }\n`,
      );
      await fs.writeFile(
        path.join(root, "farm.config.ts"),
        `import { defineConfig } from "@farm.js/core";
import { auth0 } from "@farm.js/auth0";
export default defineConfig({
  telemetry: false,
  vite: { server: { host: "127.0.0.1", strictPort: false } },
  integrations: {
    auth0: auth0({
      domain: "tenant.us.auth0.com",
      clientId: "client_test",
      clientSecret: "client_secret_test",
      secret: "a".repeat(32),
      protectedRoutes: ["/api(.*)"],
    }),
  },
});
`,
      );

      const dev = await startDevServer({ root }, 0);
      try {
        const address = dev.httpServer!.address();
        if (!address || typeof address === "string")
          throw new Error("Dev server did not bind a TCP port");
        const base = `http://127.0.0.1:${address.port}`;

        // Leg A: unauthenticated PATCH to a protected API route. The middleware
        // fires before the API route is matched and must 303 (not 307).
        const protectedResponse = await fetch(`${base}/api/profile`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "test" }),
          redirect: "manual",
        });
        expect(protectedResponse.status).toBe(303);
        const location = protectedResponse.headers.get("location");
        expect(location).not.toBeNull();
        expect(location).toContain("/auth/login");
        expect(location).toContain("returnTo=%2Fapi%2Fprofile");

        // Leg B: 303 mandates a GET to the Location (RFC 7231 §6.4.4). A GET to
        // the GET-only login route runs the handler and 302-redirects to
        // /authorize — the login flow is NOT bypassed.
        const loginResponse = await fetch(location!, { method: "GET", redirect: "manual" });
        expect(loginResponse.status).toBe(302);
        const authorize = loginResponse.headers.get("location");
        expect(authorize).toMatch(/\/authorize/);
        expect(authorize).toContain("client_id=client_test");

        // Contract corroborator: a method-preserved PATCH to the login route is
        // NOT handled by the GET-only login handler, so it must never 302 to
        // /authorize. This is the fall-through path a 307 would have forced the
        // client into; the exact fall-through status is fixture-dependent, but
        // the invariant is that no /authorize redirect is ever produced.
        const bypassedLogin = await fetch(location!, { method: "PATCH", redirect: "manual" });
        expect(bypassedLogin.status).not.toBe(302);
        expect(bypassedLogin.headers.get("location") ?? "").not.toMatch(/\/authorize/);
      } finally {
        await dev.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }, 120_000);
});
