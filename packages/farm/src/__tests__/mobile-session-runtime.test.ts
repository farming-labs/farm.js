// @vitest-environment node

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import type { ViteDevServer } from "vite";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots = new Set<string>();
const servers = new Set<ViteDevServer>();
const children = new Set<ChildProcess>();
const disposers = new Set<() => Promise<void>>();
const APP = "com.example.notes";

afterEach(async () => {
  for (const child of children) child.kill("SIGKILL");
  children.clear();
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  // A dev server runs the app in this process: a sign-out must not end the next test's session.
  delete (globalThis as { __farmTestEnded?: Set<string> }).__farmTestEnded;
  // Handles a closed server leaves open in this process, such as @farm.js/auth's SQLite file.
  // Windows cannot remove an open file, and fs.rm retries at every directory level, so a leaked
  // handle stalls the rm below for minutes instead of failing.
  for (const dispose of disposers) await dispose();
  disposers.clear();
  await Promise.all(
    [...roots].map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 10 })),
  );
  roots.clear();
});

/**
 * An app with a `mobile` block and an auth integration whose `sid` cookie signs in "alice",
 * until /api/sign-out ends that session. /api/notes runs Farm's origin check, as an auth or
 * integration route does, and the integration guards /account as `protectedRoutes` does.
 */
const farmConfig = (experimental = "") => `import { defineIntegration } from "@farm.js/core";
const readSession = (request) => {
  const sid = /(?:^|;\\s*)sid=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1];
  const ended = globalThis.__farmTestEnded ?? new Set();
  return sid === "alice-session" && !ended.has(sid) ? { id: sid, userId: "alice" } : null;
};
export default {
  telemetry: false,
  images: { provider: "none" },${experimental}
  mobile: { id: "${APP}", server: "https://notes.example.com" },
  integrations: {
    auth: defineIntegration({
      category: "auth",
      type: "test-auth",
      instance: {},
      session: readSession,
      middleware: [
        {
          matcher: ["/account"],
          handler(request) {
            if (readSession(request)) return;
            return new Response("signed out", { status: 401 });
          },
        },
      ],
    }),
  },
};`;

const FILES: Record<string, string> = {
  "package.json": '{"name":"notes","type":"module","private":true}',
  "farm.config.ts": farmConfig(),
  "src/app/layout.tsx": `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  "src/app/page.tsx": `export default function Page() { return <main>notes</main>; }`,
  "src/app/account/page.tsx": `export default function Account() { return <main>ACCOUNT_PAGE</main>; }`,
  "src/app/api/me/route.ts": `export function GET(request) {
  return Response.json({ cookie: request.headers.get("cookie"), authorization: request.headers.get("authorization") });
}`,
  "src/app/api/notes/route.ts": `import { validateIntegrationRequestOrigin } from "@farm.js/core";
export function POST(request) {
  const ok = validateIntegrationRequestOrigin(request).ok;
  return Response.json({ ok }, { status: ok ? 200 : 403 });
}`,
  "src/app/api/sign-out/route.ts": `export function POST(request) {
  const sid = /(?:^|;\\s*)sid=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1];
  (globalThis.__farmTestEnded ??= new Set()).add(sid);
  return new Response(null, { status: 204, headers: { "set-cookie": "sid=; Path=/; Max-Age=0" } });
}`,
};

async function createApp(
  prefix: string,
  files: Record<string, string> = FILES,
  packages: Record<string, string> = {},
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  roots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const [name, target] of Object.entries(packages)) {
    await fs.symlink(target, path.join(root, "node_modules", name), "junction");
  }
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  for (const [file, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), source);
  }
  return root;
}

interface Reply {
  status: number;
  setCookie: string[];
  cacheControl: string | undefined;
  vary: string | undefined;
  body: string;
}

/** node:http, so a request carries exactly the headers given: a native client's shape. */
function send(
  host: string,
  port: number,
  pathname: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host, port, path: pathname, method: options.method ?? "GET", headers: options.headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            setCookie: [res.headers["set-cookie"] ?? []].flat(),
            cacheControl: res.headers["cache-control"],
            vary: [res.headers.vary ?? []].flat().join(", ") || undefined,
            body,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

/** The shell's flow and the bypass attempts, against a running server. */
async function expectMobileSessions(
  host: string,
  port: number,
  options: { mobileClient?: boolean } = {},
) {
  const call = (pathname: string, options: Parameters<typeof send>[3] = {}) =>
    send(host, port, pathname, options);
  const native = (extra: Record<string, string> = {}) => ({
    "x-farm-mobile": APP,
    "content-type": "application/json",
    ...extra,
  });
  const cookie = "sid=alice-session; theme=dark";

  const challenge = await call("/__farm/mobile/session/challenge", {
    method: "POST",
    headers: native({ cookie }),
  });
  expect(challenge.status, challenge.body).toBe(200);
  const { nonce } = JSON.parse(challenge.body) as { nonce: string };
  const issued = await call("/__farm/mobile/session", {
    method: "POST",
    headers: native({ cookie, "x-farm-mobile-nonce": nonce }),
  });
  expect(issued.status, issued.body).toBe(200);
  const { accessToken } = JSON.parse(issued.body) as { accessToken: string };
  const marker = issued.setCookie[0]!.split(";")[0]!;
  expect(marker).toMatch(/^farm_mobile=[\w-]{22}$/);

  // The bearer runs as the cookie session, same-origin, and is private.
  const me = await call("/api/me", { headers: native({ authorization: `Bearer ${accessToken}` }) });
  expect(me.status, me.body).toBe(200);
  expect(JSON.parse(me.body)).toEqual({ cookie, authorization: null });
  expect(me.cacheControl).toBe("private, no-store");
  const mutation = await call("/api/notes", {
    method: "POST",
    headers: native({ authorization: `Bearer ${accessToken}` }),
    body: "{}",
  });
  expect(mutation.status).toBe(200);

  // A protected page runs its guard on the device's cookie session.
  const account = await call("/account", {
    headers: native({ authorization: `Bearer ${accessToken}` }),
  });
  expect(account.status, account.body).toBe(200);
  expect(account.body).toContain("ACCOUNT_PAGE");
  expect(account.cacheControl).toBe("private, no-store");
  expect((await call("/account", { headers: native() })).status).toBe(401);
  // A forged token, or a real one sent by a browser page, does not sign in.
  const forged = await call("/account", {
    headers: native({ authorization: `Bearer ${accessToken.slice(0, -4)}AAAA` }),
  });
  expect(forged.status).toBe(401);
  expect(forged.body).not.toContain("ACCOUNT_PAGE");
  const browserPage = await call("/account", {
    headers: native({
      authorization: `Bearer ${accessToken}`,
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "navigate",
    }),
  });
  expect(browserPage.status).toBe(401);

  // Without a token, the same native-shaped mutation keeps today's origin check.
  const cookieOnly = await call("/api/notes", {
    method: "POST",
    headers: native({ cookie }),
    body: "{}",
  });
  expect(cookieOnly.status).toBe(403);
  // A browser page's bearer is ignored.
  const browser = await call("/api/notes", {
    method: "POST",
    headers: native({
      authorization: `Bearer ${accessToken}`,
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    }),
    body: "{}",
  });
  expect(browser.status).toBe(403);
  // Another app id is rejected.
  const otherApp = await call("/api/me", {
    headers: native({
      authorization: `Bearer ${accessToken}`,
      "x-farm-mobile": "com.example.other",
    }),
  });
  expect(otherApp.status).toBe(401);
  // A page without a bearer is untouched.
  const page = await call("/");
  expect(page.status).toBe(200);
  expect(page.setCookie.filter((line) => line.startsWith("farm_mobile"))).toEqual([]);

  if (options.mobileClient) {
    // A production build of the app also serves the mobile client to the documents a shell asks
    // for. That rewrite is for HTML only: session endpoints and bearer responses keep their own
    // cache policy, even when a shell header reaches them.
    const shell = { "x-farm-shell": "android" };
    expect(page.vary?.toLowerCase().split(", ")).toContain("x-farm-shell");
    expect(page.body).not.toContain("farm-mobile-client-");
    const document = await call("/", { headers: { ...shell, cookie: `${cookie}; ${marker}` } });
    expect(document.status).toBe(200);
    expect(document.cacheControl).toBe("private, no-store");
    expect(document.vary?.toLowerCase().split(", ")).toContain("x-farm-shell");
    expect(document.body).toContain("farm-mobile-client-");
    expect(document.setCookie.filter((line) => line.startsWith("farm_mobile"))).toEqual([]);
    const shellChallenge = await call("/__farm/mobile/session/challenge", {
      method: "POST",
      headers: native({ ...shell, cookie }),
    });
    expect(shellChallenge.status, shellChallenge.body).toBe(200);
    expect(shellChallenge.cacheControl).toBe("no-store");
    expect(shellChallenge.vary ?? "").not.toMatch(/x-farm-shell/i);
    const shellMe = await call("/api/me", {
      headers: native({ ...shell, authorization: `Bearer ${accessToken}` }),
    });
    expect(shellMe.status, shellMe.body).toBe(200);
    expect(shellMe.cacheControl).toBe("private, no-store");
    expect(shellMe.vary ?? "").not.toMatch(/x-farm-shell/i);
  }

  // Sign-out in the WebView, which carries the device marker, revokes the device.
  const signOut = await call("/api/sign-out", {
    method: "POST",
    headers: {
      cookie: `${cookie}; ${marker}`,
      origin: `http://${host}:${port}`,
      "sec-fetch-site": "same-origin",
    },
  });
  expect(signOut.setCookie.some((line) => line.startsWith("farm_mobile=; "))).toBe(true);
  const revoked = await call("/api/me", {
    headers: native({ authorization: `Bearer ${accessToken}` }),
  });
  expect(revoked.status).toBe(401);
}

/** Build the app for node-server, start it, and return its port. */
async function startProductionServer(root: string): Promise<number> {
  const config = await resolveConfig(
    { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
    "production",
  );
  await build(config, { root, preset: "node-server" });
  const port = await getAvailablePort();
  const child = spawn(
    process.execPath,
    [path.join(root, ".farm", ".output", "server", "index.mjs")],
    {
      cwd: root,
      env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.add(child);
  let output = "";
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("Listening on")) resolve();
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.once("exit", (code) => reject(new Error(`server exited ${code}: ${output}`)));
  });
  return port;
}

/** The same app with server components in islands mode, which runs on Farm's own server. */
const ISLANDS_FILES: Record<string, string> = {
  ...FILES,
  "farm.config.ts": farmConfig(`
  experimental: { serverComponents: { mode: "islands" } },`),
  "src/app/counter.tsx": `"use client";
import { useState } from "react";
export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}`,
  "src/app/page.tsx": `import { Counter } from "./counter";
export default function Page() { return <main>notes<Counter /></main>; }`,
};

describe("mobile session tokens on a running server", () => {
  it("work in farm dev", async () => {
    const root = await createApp("farm-mobile-session-dev-");
    const server = await createServer({ root });
    servers.add(server);
    const port = await getAvailablePort();
    await server.listen(port);
    await expectMobileSessions("localhost", port);
  }, 120_000);

  it("work in a production build", async (ctx) => {
    if (process.platform === "win32") ctx.skip();
    const root = await createApp("farm-mobile-session-build-");
    const port = await startProductionServer(root);
    await expectMobileSessions("127.0.0.1", port, { mobileClient: true });
  }, 240_000);

  it("work in farm dev of a server components app in islands mode", async () => {
    const root = await createApp("farm-mobile-session-islands-dev-", ISLANDS_FILES);
    const server = await createServer({ root });
    servers.add(server);
    const port = await getAvailablePort();
    await server.listen(port);
    await expectMobileSessions("localhost", port);
  }, 120_000);

  it("work in a production build of a server components app in islands mode", async (ctx) => {
    if (process.platform === "win32") ctx.skip();
    const root = await createApp("farm-mobile-session-islands-build-", ISLANDS_FILES);
    const port = await startProductionServer(root);
    await expectMobileSessions("127.0.0.1", port, { mobileClient: true });
  }, 240_000);
});

/**
 * An app with `auth: true` (`@farm.js/auth` on Better Auth, SQLite in dev) and a route that needs
 * a signed-in user.
 */
const AUTH_FILES: Record<string, string> = {
  "package.json": '{"name":"notes","type":"module","private":true}',
  "farm.config.ts": `export default {
  telemetry: false,
  images: { provider: "none" },
  mobile: { id: "${APP}", server: "https://notes.example.com" },
  auth: true,
};`,
  "src/app/layout.tsx": FILES["src/app/layout.tsx"]!,
  "src/app/page.tsx": FILES["src/app/page.tsx"]!,
  "src/app/api/me/route.ts": `import { auth } from "@farm.js/auth/server";
export async function GET() {
  const user = await auth.user();
  return user ? Response.json({ email: user.email }) : new Response(null, { status: 401 });
}`,
};

describe("native sign-in against @farm.js/auth", () => {
  it("signs in from a request shaped like the shell's, then issues and uses the device token", async (ctx) => {
    // @farm.js/auth opens its dev database with node:sqlite, and Better Auth's node:sqlite dialect
    // calls StatementSync#columns(), which Node added in 22.16.0 and 23.11.0. On Node 22.13 to
    // 22.15 every query throws "stmt.columns is not a function", so `auth: true` cannot sign up
    // there at all; that is a bug in @farm.js/auth, not in the native sign-in flow this tests.
    const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
    if (typeof sqlite.StatementSync.prototype.columns !== "function") ctx.skip();
    // Better Auth turns its origin and CSRF checks off under NODE_ENV=test or TEST, which vitest
    // sets; run it as farm dev does, with every check on.
    const env = { NODE_ENV: process.env.NODE_ENV, TEST: process.env.TEST };
    process.env.NODE_ENV = "development";
    delete process.env.TEST;
    onTestFinished(() => {
      for (const [key, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    const authPackage = await fs.realpath(path.resolve(packageRoot, "..", "farm-auth"));
    // The dev server keeps @farm.js/auth's runtime, and its open SQLite file, on globalThis after
    // it closes, as `farm dev` does for the life of the process.
    const { disposeFarmAuth } = (await import(
      pathToFileURL(path.join(authPackage, "dist", "internal.js")).href
    )) as { disposeFarmAuth: () => Promise<void> };
    disposers.add(disposeFarmAuth);
    const root = await createApp("farm-mobile-native-sign-in-", AUTH_FILES, {
      "@farm.js/auth": authPackage,
    });
    const server = await createServer({ root });
    servers.add(server);
    const port = await getAvailablePort();
    await server.listen(port);
    const call = (pathname: string, options: Parameters<typeof send>[3] = {}) =>
      send("localhost", port, pathname, options);
    // Exactly what MobileSession.signIn sends (Kotlin and Swift): POST, JSON, no Cookie, no
    // Origin, no Sec-Fetch-*, no app id header.
    const shellSignIn = (route: string, body: unknown) =>
      call(`/api/auth/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
    const sessionCookies = (reply: Reply) =>
      reply.setCookie.map((line) => line.split(";")[0]!).filter((pair) => !pair.endsWith("="));
    const native = (extra: Record<string, string> = {}) => ({ "x-farm-mobile": APP, ...extra });
    const ada = { email: "ada@example.com", password: "correct horse battery", name: "Ada" };

    // Sign-up, as `signUp` sends it, creates the user and a session cookie.
    const created = await shellSignIn("sign-up/email", ada);
    expect(created.status, created.body).toBe(200);
    expect(JSON.parse(created.body).user.email).toBe(ada.email);
    expect(
      sessionCookies(created).some((pair) => pair.startsWith("better-auth.session_token=")),
    ).toBe(true);

    // A taken email: Better Auth's error, and no cookie for the shell to keep.
    const taken = await shellSignIn("sign-up/email", ada);
    expect(taken.status, taken.body).toBe(422);
    expect(JSON.parse(taken.body).code).toBe("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL");
    expect(taken.setCookie).toEqual([]);

    // A wrong password: the error the web client gets, no cookie, and so no token can be minted.
    const refused = await shellSignIn("sign-in/email", { email: ada.email, password: "wrong one" });
    expect(refused.status, refused.body).toBe(401);
    expect(JSON.parse(refused.body).code).toBe("INVALID_EMAIL_OR_PASSWORD");
    expect(refused.setCookie).toEqual([]);
    const noSession = await call("/__farm/mobile/session/challenge", {
      method: "POST",
      headers: native(),
    });
    expect(noSession.status).toBe(401);

    // A browser page cannot use the same route cross-site: Better Auth checks a sent Origin.
    const crossSite = await call("/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "cors",
      },
      body: JSON.stringify({ email: ada.email, password: ada.password }),
    });
    expect(crossSite.status).toBe(403);
    expect(crossSite.setCookie).toEqual([]);

    // The real sign-in.
    const signedIn = await shellSignIn("sign-in/email", {
      email: ada.email,
      password: ada.password,
    });
    expect(signedIn.status, signedIn.body).toBe(200);
    const body = JSON.parse(signedIn.body) as { token: string; user: { email: string } };
    expect(body.user.email).toBe(ada.email);
    const jar = sessionCookies(signedIn);
    expect(jar.some((pair) => pair.startsWith("better-auth.session_token="))).toBe(true);
    // The body's session token is no credential by itself: the session cookie is signed, and
    // @farm.js/auth has no bearer plugin.
    for (const headers of [
      { authorization: `Bearer ${body.token}` },
      { cookie: `better-auth.session_token=${body.token}` },
    ]) {
      const session = await call("/api/auth/get-session", { headers });
      expect(session.status).toBe(200);
      expect(JSON.parse(session.body)).toBeNull();
    }

    // The existing exchange, with the cookies the shell put in the WebView's store.
    const cookie = jar.join("; ");
    const challenge = await call("/__farm/mobile/session/challenge", {
      method: "POST",
      headers: native({ cookie }),
    });
    expect(challenge.status, challenge.body).toBe(200);
    const { nonce } = JSON.parse(challenge.body) as { nonce: string };
    const issued = await call("/__farm/mobile/session", {
      method: "POST",
      headers: native({ cookie, "x-farm-mobile-nonce": nonce }),
    });
    expect(issued.status, issued.body).toBe(200);
    const { accessToken } = JSON.parse(issued.body) as { accessToken: string };

    // The bearer signs in a protected route and the session route useAuth reads.
    const bearer = native({ authorization: `Bearer ${accessToken}`, accept: "application/json" });
    const me = await call("/api/me", { headers: bearer });
    expect(me.status, me.body).toBe(200);
    expect(JSON.parse(me.body)).toEqual({ email: ada.email });
    const session = await call("/api/auth/get-session", { headers: bearer });
    expect(session.status, session.body).toBe(200);
    expect(JSON.parse(session.body).user.email).toBe(ada.email);
    // Without it, the route is protected.
    expect((await call("/api/me")).status).toBe(401);
  }, 120_000);
});
