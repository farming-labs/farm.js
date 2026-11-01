// @vitest-environment node

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { installFarmDesktopSetup } from "../desktop/config";
import { FARM_DESKTOP_DEV_SESSION } from "../desktop/dev-guard";
import { FARM_DESKTOP_COOKIE, FARM_DESKTOP_HANDSHAKE_PATH } from "../desktop/guard";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const isWindows = process.platform === "win32";
const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();
const children = new Set<ChildProcess>();
const previousPlatform = process.env.FARM_PLATFORM;

afterEach(async () => {
  connectHost = "127.0.0.1";
  for (const child of children) child.kill("SIGKILL");
  children.clear();
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  delete (globalThis as Record<PropertyKey, unknown>)[FARM_DESKTOP_DEV_SESSION];
  if (previousPlatform === undefined) delete process.env.FARM_PLATFORM;
  else process.env.FARM_PLATFORM = previousPlatform;
  delete process.env.FARM_DESKTOP_DATA_DIR;
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

const APP_FILES: Record<string, string> = {
  "farm.config.ts": `import { definePlugin } from "@farm.js/core";
export default {
  telemetry: false,
  desktop: { name: "Notes", id: "com.example.notes" },
  plugins: [
    definePlugin({
      name: "test:desktop-endpoint",
      runtime: {
        endpoints: [{ path: "/plugin-endpoint", handler: () => new Response("endpoint") }],
        async close() {
          const { appendFile } = await import("node:fs/promises");
          if (process.env.FARM_TEST_CLOSE_MARKER) {
            await appendFile(process.env.FARM_TEST_CLOSE_MARKER, "closed\\n");
          }
        },
      },
    }),
  ],
};`,
  "src/app/layout.tsx": `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  "src/app/page.tsx": `import { platform } from "@farm.js/core/platform";
export default function Page() { return <main data-platform={platform()}>desktop notes home</main>; }`,
  "src/app/api/data/route.ts": `import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appDataDir, platform } from "@farm.js/core/platform";
export async function GET() {
  const dir = appDataDir();
  await writeFile(join(dir, "note.txt"), "saved");
  return Response.json({ dir, platform: platform() });
}`,
};

async function createApp(prefix: string, files = APP_FILES): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  await fs.writeFile(
    path.join(root, "package.json"),
    '{"name":"notes","version":"1.2.3","type":"module","private":true}',
  );
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

function secretPair() {
  return {
    secret: randomBytes(32).toString("base64url"),
    handshakeToken: randomBytes(32).toString("base64url"),
  };
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** The dev server listens on localhost, which may be ::1 only; the desktop server on 127.0.0.1. */
let connectHost = "127.0.0.1";

/** node:http, because fetch() does not let a test choose the Host header. */
function raw(
  port: number,
  pathname: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: connectHost,
        port,
        path: pathname,
        method: options.method ?? "GET",
        headers: {
          host: `${connectHost.includes(":") ? `[${connectHost}]` : connectHost}:${port}`,
          ...options.headers,
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Everything a desktop guard must hold, against a running server. */
async function expectDesktopGuard(port: number, token: string, options: { dev: boolean }) {
  expect((await raw(port, "/")).status).toBe(403);

  const handshake = await raw(port, `${FARM_DESKTOP_HANDSHAKE_PATH}?t=${token}`);
  expect(handshake.status).toBe(303);
  expect(handshake.headers.location).toBe("/");
  const setCookie = [handshake.headers["set-cookie"]].flat()[0] ?? "";
  expect(setCookie).toMatch(/HttpOnly; SameSite=Strict$/);
  const cookie = setCookie.split(";")[0];
  expect(cookie.startsWith(`${FARM_DESKTOP_COOKIE}=`)).toBe(true);
  expect((await raw(port, `${FARM_DESKTOP_HANDSHAKE_PATH}?t=${token}`)).status).toBe(403);

  const home = await raw(port, "/", { headers: { cookie } });
  expect(home.status).toBe(200);
  expect(home.body).toContain("desktop notes home");
  expect(home.body).toContain('data-platform="desktop"');

  const data = await raw(port, "/api/data", { headers: { cookie } });
  expect(data.status).toBe(200);
  const payload = JSON.parse(data.body) as { dir: string; platform: string };
  expect(payload.platform).toBe("desktop");
  await expect(fs.readFile(path.join(payload.dir, "note.txt"), "utf8")).resolves.toBe("saved");

  const scriptSrc = /<script[^>]+src="([^"]+)"/.exec(home.body)?.[1];
  expect(scriptSrc, "page loads a client script").toBeTruthy();
  const assetPaths = options.dev ? ["/@vite/client", scriptSrc!] : [scriptSrc!];
  const probes = [
    { name: "page", path: "/" },
    { name: "api route", path: "/api/data" },
    { name: "plugin endpoint", path: "/plugin-endpoint" },
    { name: "default mcp", path: "/mcp", method: "POST" },
    { name: "llms.txt", path: "/llms.txt" },
    { name: "app manifest", path: "/.well-known/farmjs.json" },
    { name: "markdown mirror", path: "/index.md" },
    { name: "server action post", path: "/", method: "POST" },
    ...assetPaths.map((asset) => ({ name: `client asset ${asset}`, path: asset })),
  ];
  const unguarded: string[] = [];
  for (const probe of probes) {
    const blocked = await raw(port, probe.path, { method: probe.method });
    if (blocked.status !== 403) unguarded.push(`${probe.name}: ${blocked.status}`);
  }
  expect(unguarded).toEqual([]);

  // With the cookie, the window gets the app; public-site surfaces are off.
  expect((await raw(port, "/plugin-endpoint", { headers: { cookie } })).body).toBe("endpoint");
  expect((await raw(port, scriptSrc!, { headers: { cookie } })).status).toBe(200);
  for (const pathname of ["/llms.txt", "/sitemap.xml", "/.well-known/farmjs.json"]) {
    expect((await raw(port, pathname, { headers: { cookie } })).status, pathname).toBe(404);
  }

  for (const host of [`evil.example:${port}`, `192.168.1.20:${port}`, `127.0.0.1:${port + 1}`]) {
    expect((await raw(port, "/", { headers: { cookie, host } })).status, host).toBe(403);
  }
  expect(
    (await raw(port, "/", { headers: { cookie, "sec-fetch-site": "same-site" } })).status,
  ).toBe(403);
  expect(
    (
      await raw(port, "/api/data", {
        method: "POST",
        headers: { cookie, origin: "http://localhost:5173" },
      })
    ).status,
  ).toBe(403);
}

function waitForLine(
  child: ChildProcess,
  pattern: RegExp,
  output: string[],
): Promise<RegExpExecArray> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${pattern}:\n${output.join("")}`)),
      30_000,
    );
    const check = () => {
      const match = pattern.exec(output.join(""));
      if (match) {
        clearTimeout(timer);
        resolve(match);
      }
    };
    child.stdout?.on("data", (chunk) => {
      output.push(String(chunk));
      check();
    });
    child.stderr?.on("data", (chunk) => output.push(String(chunk)));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited with ${code} before ${pattern}:\n${output.join("")}`));
    });
  });
}

async function buildDesktop(root: string, preset: "bun" | "node-server") {
  installFarmDesktopSetup({ command: "build" });
  process.env.FARM_PLATFORM = "desktop";
  try {
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
      "production",
    );
    await build(config, { root, preset });
    return path.join(root, config.deploy.outputDir);
  } finally {
    delete process.env.FARM_PLATFORM;
  }
}

describe("farm dev --desktop", () => {
  it("guards pages, APIs, endpoints, agent surfaces, and Vite's own modules", async () => {
    const root = await createApp("farm-desktop-dev-");
    const session = secretPair();
    installFarmDesktopSetup({ command: "dev" });
    process.env.FARM_PLATFORM = "desktop";
    process.env.FARM_DESKTOP_DATA_DIR = path.join(root, ".farm", "data", "desktop");
    (globalThis as Record<PropertyKey, unknown>)[FARM_DESKTOP_DEV_SESSION] = session;
    const server = await createServer({ root });
    servers.add(server);
    const port = await getAvailablePort();
    await server.listen(port);
    connectHost = "localhost";

    await expectDesktopGuard(port, session.handshakeToken, { dev: true });
  }, 120_000);

  it("guards the RSC dev server of an app with experimental.serverComponents", async () => {
    const root = await createApp("farm-desktop-rsc-dev-", {
      "farm.config.ts": `export default {
  telemetry: false,
  desktop: { name: "Notes", id: "com.example.notes" },
  experimental: { serverComponents: true },
};`,
    });
    // Stand-ins for the RSC packages: the guard must not depend on what the pipeline serves.
    const addPackage = async (name: string, manifest: object, files: Record<string, string>) => {
      const dir = path.join(root, "node_modules", ...name.split("/"));
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name, type: "module", ...manifest }),
      );
      for (const [file, source] of Object.entries(files)) {
        await fs.writeFile(path.join(dir, file), source);
      }
    };
    await addPackage(
      "@farm.js/plugin",
      { exports: { "./rsc": { import: "./rsc.js" } } },
      {
        "rsc.js": `export function defineConfig(config) { return { plugins: config.plugins, server: { port: config.port } }; }
export function nitro() { return { name: "nitro" }; }`,
      },
    );
    await addPackage(
      "@vitejs/plugin-rsc",
      { exports: { ".": { import: "./index.js" } } },
      { "index.js": `export default function rsc() { return { name: "rsc" }; }` },
    );
    await addPackage("react-server-dom-webpack", {}, {});

    const session = secretPair();
    installFarmDesktopSetup({ command: "dev" });
    process.env.FARM_PLATFORM = "desktop";
    (globalThis as Record<PropertyKey, unknown>)[FARM_DESKTOP_DEV_SESSION] = session;
    const server = await createServer({ root });
    servers.add(server);
    const port = await getAvailablePort();
    await server.listen(port);
    connectHost = "localhost";

    for (const pathname of ["/", "/@vite/client", "/farm.config.ts"]) {
      expect((await raw(port, pathname)).status, pathname).toBe(403);
    }
    const handshake = await raw(port, `${FARM_DESKTOP_HANDSHAKE_PATH}?t=${session.handshakeToken}`);
    expect(handshake.status).toBe(303);
    const cookie = ([handshake.headers["set-cookie"]].flat()[0] ?? "").split(";")[0];
    expect(cookie.startsWith(`${FARM_DESKTOP_COOKIE}=`)).toBe(true);
    expect((await raw(port, "/@vite/client", { headers: { cookie } })).status).toBe(200);
    expect(
      (await raw(port, "/@vite/client", { headers: { cookie, host: `evil.example:${port}` } }))
        .status,
    ).toBe(403);
  }, 120_000);

  it("runs the guard before middleware from enforce: pre Vite plugins", async () => {
    const root = await createApp("farm-desktop-dev-pre-", {
      ...APP_FILES,
      "farm.config.ts": `export default {
  telemetry: false,
  desktop: { name: "Notes", id: "com.example.notes" },
  vite: {
    plugins: [
      {
        name: "test:pre-middleware",
        enforce: "pre",
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url !== "/pre-plugin") return next();
            res.end("pre plugin");
          });
        },
      },
    ],
  },
};`,
    });
    const session = secretPair();
    installFarmDesktopSetup({ command: "dev" });
    process.env.FARM_PLATFORM = "desktop";
    process.env.FARM_DESKTOP_DATA_DIR = path.join(root, ".farm", "data", "desktop");
    (globalThis as Record<PropertyKey, unknown>)[FARM_DESKTOP_DEV_SESSION] = session;
    const server = await createServer({ root });
    servers.add(server);
    const port = await getAvailablePort();
    await server.listen(port);
    connectHost = "localhost";

    expect((await raw(port, "/pre-plugin")).status).toBe(403);
    const handshake = await raw(port, `${FARM_DESKTOP_HANDSHAKE_PATH}?t=${session.handshakeToken}`);
    expect(handshake.status).toBe(303);
    const cookie = ([handshake.headers["set-cookie"]].flat()[0] ?? "").split(";")[0];
    const allowed = await raw(port, "/pre-plugin", { headers: { cookie } });
    expect(allowed.status).toBe(200);
    expect(allowed.body).toBe("pre plugin");
  }, 120_000);
});

describe("farm build --desktop", () => {
  it("runs as a sidecar on port 0 with the Node runtime and prints the ready line", async (ctx) => {
    if (isWindows) ctx.skip();
    const root = await createApp("farm-desktop-node-");
    const outputDir = await buildDesktop(root, "node-server");
    expect(outputDir).toBe(path.join(root, ".farm", "output", "desktop", "server"));
    const session = secretPair();
    const dataDir = path.join(root, "user-data");
    const output: string[] = [];
    const child = spawn(process.execPath, [path.join(outputDir, "server", "index.mjs")], {
      cwd: root,
      env: {
        ...process.env,
        // The user's PORT and HOST must not move a desktop server off 127.0.0.1:0.
        PORT: "3999",
        HOST: "0.0.0.0",
        FARM_DESKTOP_SECRET: session.secret,
        FARM_DESKTOP_HANDSHAKE_TOKEN: session.handshakeToken,
        FARM_DESKTOP_DATA_DIR: dataDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    const ready = await waitForLine(child, /farm:ready (\{"port":\d+\})\n/, output);
    const { port } = JSON.parse(ready[1]) as { port: number };
    expect(port).not.toBe(3999);

    await expectDesktopGuard(port, session.handshakeToken, { dev: false });
    await expect(fs.readFile(path.join(dataDir, "note.txt"), "utf8")).resolves.toBe("saved");
  }, 240_000);

  it("starts in-process with start() under Bun and stops through Farm's shutdown", async (ctx) => {
    if (isWindows || !hasBun) ctx.skip();
    const root = await createApp("farm-desktop-bun-");
    const outputDir = await buildDesktop(root, "bun");
    const session = secretPair();
    const dataDir = path.join(root, "user-data");
    const marker = path.join(root, "close.log");
    await fs.writeFile(
      path.join(root, "shell.mjs"),
      `const { start } = await import(${JSON.stringify(path.join(outputDir, "server", "index.mjs"))});
const server = await start(${JSON.stringify({ ...session, dataDir })});
console.log("STARTED " + JSON.stringify({ origin: server.origin, port: server.port }));
process.stdin.once("data", async () => {
  await server.stop();
  console.log("STOPPED");
});`,
    );
    const output: string[] = [];
    const child = spawn("bun", [path.join(root, "shell.mjs")], {
      cwd: root,
      env: { ...process.env, FARM_TEST_CLOSE_MARKER: marker },
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.add(child);
    const started = await waitForLine(child, /STARTED (\{.+\})\n/, output);
    const { origin, port } = JSON.parse(started[1]) as { origin: string; port: number };
    expect(origin).toBe(`http://127.0.0.1:${port}`);
    // The secret stays in the shell: start() takes it as an argument, never from the env.
    expect(output.join("")).not.toContain(session.secret);

    await expectDesktopGuard(port, session.handshakeToken, { dev: false });

    const stopped = waitForLine(child, /STOPPED\n/, output);
    child.stdin?.write("stop\n");
    await stopped;
    await expect(fs.readFile(marker, "utf8")).resolves.toBe("closed\n");
  }, 240_000);
});

async function outputManifest(dir: string): Promise<Record<string, string>> {
  const manifest: Record<string, string> = {};
  for (const entry of await fs.readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const relative = path.relative(dir, file);
    let contents = await fs.readFile(file);
    // Nitro stamps the build time into nitro.json, and file mtimes into the server entry's
    // public asset table, whose order also follows the file system. Neither is app code.
    if (relative === "nitro.json") {
      contents = Buffer.from(contents.toString("utf8").replace(/"date": "[^"]+"/, '"date": ""'));
    } else if (relative === path.join("server", "index.mjs")) {
      const lines = contents.toString("utf8").split("\n");
      contents = Buffer.from(
        lines
          .filter((line) => !/^\s*mtime: /.test(line))
          .sort()
          .join("\n"),
      );
    }
    manifest[relative] = createHash("sha256").update(contents).digest("hex");
  }
  return manifest;
}

describe("a web build", () => {
  it("is byte-identical with or without a desktop block and carries no desktop code", async () => {
    // A runtime plugin, so the server bundle imports farm.config itself.
    const webConfig = (desktop: string) => `import { definePlugin } from "@farm.js/core";
import { readFileSync } from "node:fs";
export default {
  telemetry: false,
  deploymentId: "fixed",
  plugins: [definePlugin({ name: "test:runtime", runtime: { cache: "public", before() {} } })],${desktop}
};`;
    const files = {
      "farm.config.ts": webConfig(""),
      "src/app/layout.tsx": APP_FILES["src/app/layout.tsx"],
      "src/app/page.tsx": APP_FILES["src/app/page.tsx"],
      "src/app/api/data/route.ts": `import { platform } from "@farm.js/core/platform";
export function GET() { return Response.json({ platform: platform() }); }`,
    };
    const root = await createApp("farm-desktop-web-", files);
    const buildWeb = async () => {
      const config = await resolveConfig(
        { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
        "production",
      );
      expect(config.desktop).toBeNull();
      await build(config, { root, preset: "node-server" });
      return outputManifest(path.join(root, ".farm", ".output"));
    };

    // Warm build: later builds read caches the first one writes.
    await buildWeb();
    const without = await buildWeb();
    await fs.writeFile(
      path.join(root, "farm.config.ts"),
      webConfig(`\n  desktop: { name: "DESKTOP_STATIC_MARKER", window: { width: 900 } },`),
    );
    expect(await buildWeb()).toEqual(without);
    const calledMarker = path.join(root, "desktop-fn-called");
    await fs.writeFile(
      path.join(root, "farm.config.ts"),
      webConfig(`
  desktop: async ({ root, profile }) => {
    (await import("node:fs")).writeFileSync(${JSON.stringify(calledMarker)}, "called");
    return { name: "DESKTOP_FN_MARKER " + profile, version: JSON.parse(readFileSync(root + "/package.json", "utf8")).version };
  },`),
    );
    expect(await buildWeb()).toEqual(without);
    // A web build never calls the function.
    await expect(fs.stat(calledMarker)).rejects.toThrow();

    const serverDir = path.join(root, ".farm", ".output", "server");
    const offenders: string[] = [];
    for (const entry of await fs.readdir(serverDir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.m?js$/.test(entry.name)) continue;
      const file = path.join(entry.parentPath, entry.name);
      // Core's own dist is traced into node_modules as a package, not app server code.
      if (file.includes(`${path.sep}node_modules${path.sep}`)) continue;
      const source = await fs.readFile(file, "utf8");
      for (const marker of [
        "createFarmDesktopGuard",
        "__farm/desktop",
        "farm:ready",
        "DESKTOP_FN_MARKER",
        "DESKTOP_STATIC_MARKER",
      ]) {
        if (source.includes(marker)) offenders.push(`${path.relative(serverDir, file)}: ${marker}`);
      }
    }
    expect(offenders).toEqual([]);
  }, 300_000);
});
