// @vitest-environment node

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots = new Set<string>();
const servers = new Set<ViteDevServer>();
const children = new Set<ChildProcess>();
const APP = "com.example.notes";

afterEach(async () => {
  for (const child of children) child.kill("SIGKILL");
  children.clear();
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all(
    [...roots].map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 10 })),
  );
  roots.clear();
});

/**
 * An app with a `mobile` block and an auth integration whose `sid` cookie signs in "alice",
 * until /api/sign-out ends that session. /api/notes runs Farm's origin check, as an auth or
 * integration route does.
 */
const FILES: Record<string, string> = {
  "package.json": '{"name":"notes","type":"module","private":true}',
  "farm.config.ts": `import { defineIntegration } from "@farm.js/core";
export default {
  telemetry: false,
  images: { provider: "none" },
  mobile: { id: "${APP}", server: "https://notes.example.com" },
  integrations: {
    auth: defineIntegration({
      category: "auth",
      type: "test-auth",
      instance: {},
      session(request) {
        const sid = /(?:^|;\\s*)sid=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1];
        const ended = globalThis.__farmTestEnded ?? new Set();
        return sid === "alice-session" && !ended.has(sid) ? { id: sid, userId: "alice" } : null;
      },
    }),
  },
};`,
  "src/app/layout.tsx": `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  "src/app/page.tsx": `export default function Page() { return <main>notes</main>; }`,
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

async function createApp(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  roots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  for (const [file, source] of Object.entries(FILES)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), source);
  }
  return root;
}

interface Reply {
  status: number;
  setCookie: string[];
  cacheControl: string | undefined;
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
async function expectMobileSessions(host: string, port: number) {
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
    await expectMobileSessions("127.0.0.1", port);
  }, 240_000);
});
