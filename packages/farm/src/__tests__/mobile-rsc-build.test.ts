// @vitest-environment node

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { buildFarmRsc } from "../rsc-pipeline";
import { getAvailablePort } from "./dev-server-port";

// A production build of an app on the RSC pipeline (`experimental.serverComponents`), served by its
// Nitro node-server output: the mobile client a build adds for a `mobile` block, the documents a
// shell asks for, and nothing of either without the block. The RSC packages come from the
// maintained server components example.

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const exampleModules = path.resolve(packageRoot, "../../examples/server-components/node_modules");
const roots = new Set<string>();
const children = new Set<ChildProcess>();

afterEach(async () => {
  for (const child of children) child.kill("SIGKILL");
  children.clear();
  await Promise.all(
    [...roots].map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 10 })),
  );
  roots.clear();
});

const MOBILE_BLOCK = `
  mobile: { id: "com.example.notes", server: "https://notes.example.com" },`;

const FILES = (mobile: string): Record<string, string> => ({
  "package.json": '{"name":"notes","version":"1.0.0","type":"module","private":true}',
  "farm.config.ts": `export default {
  deploymentId: "fixed",
  experimental: { serverComponents: { mode: "rsc" } },${mobile}
};`,
  "src/app/layout.tsx": `import { Link } from "@farm.js/core/client";
export default function Layout({ children }) {
  return <html><body><nav><Link href="/notes">notes</Link></nav>{children}</body></html>;
}`,
  "src/app/counter.tsx": `"use client";
import { useState } from "react";
export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{"count " + count}</button>;
}`,
  "src/app/page.tsx": `import { Counter } from "./counter";
export default function Page() { return <main>home<Counter /></main>; }`,
  "src/app/notes/page.tsx": `export default function Notes() { return <main>notes page</main>; }`,
  // A protected page: its guard reads the session cookie.
  "src/app/account/page.tsx": `export default function Account() { return <main>ACCOUNT_PAGE</main>; }`,
  "src/app/account/middleware.ts": `import { middleware } from "@farm.js/core/middleware";
export default middleware().use(async (ctx, next) => {
  if (!/(?:^|;\\s*)sid=alice-session(?:;|$)/.test(ctx.request.headers.get("cookie") ?? "")) {
    ctx.text("signed out", 401);
    return;
  }
  await next();
});`,
});

async function link(root: string, name: string, target: string) {
  const destination = path.join(root, "node_modules", ...name.split("/"));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.symlink(await fs.realpath(target), destination, "junction");
}

async function createApp(mobile: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-mobile-rsc-"));
  roots.add(root);
  await link(root, "@farm.js/core", packageRoot);
  for (const name of [
    "@farm.js/plugin",
    "@vitejs/plugin-rsc",
    "react-server-dom-webpack",
    "react",
    "react-dom",
    "vite",
  ]) {
    await link(root, name, path.join(exampleModules, ...name.split("/")));
  }
  for (const [file, source] of Object.entries(FILES(mobile))) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), source);
  }
  return root;
}

const OUTPUT = path.join(".farm", ".output");

async function buildApp(root: string) {
  const userConfig = await loadConfig(root, undefined, "production");
  await buildFarmRsc(userConfig as Record<string, unknown>, {
    root,
    preset: "node-server",
    outputDir: OUTPUT,
  });
}

async function startServer(root: string): Promise<number> {
  const port = await getAvailablePort();
  const child = spawn(process.execPath, [path.join(root, OUTPUT, "server", "index.mjs")], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
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

interface Reply {
  status: number;
  cacheControl: string | undefined;
  vary: string;
  body: string;
}

/** node:http, so a request carries exactly the headers given: a shell's or a native client's. */
function send(
  port: number,
  pathname: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            cacheControl: res.headers["cache-control"],
            vary: [res.headers.vary ?? []].flat().join(", "),
            body,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** App server code in the output (not the packages traced next to it) that contains `marker`. */
async function serverFilesContaining(root: string, marker: string): Promise<string[]> {
  const serverDir = path.join(root, OUTPUT, "server");
  const found: string[] = [];
  for (const entry of await fs.readdir(serverDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.m?js$/.test(entry.name)) continue;
    const file = path.join(entry.parentPath, entry.name);
    if (file.includes(`${path.sep}node_modules${path.sep}`)) continue;
    if ((await fs.readFile(file, "utf8")).includes(marker)) found.push(file);
  }
  return found;
}

const SHELL = { "x-farm-shell": "android" };

describe("a server components app on the RSC pipeline", () => {
  it("builds the mobile client for a mobile block, and serves it to the documents a shell asks for", async (ctx) => {
    if (process.platform === "win32") ctx.skip();
    const root = await createApp(MOBILE_BLOCK);
    await buildApp(root);
    const manifest = JSON.parse(
      await fs.readFile(path.join(root, ".farm", "mobile-client.json"), "utf8"),
    ) as {
      webEntry: string;
      entry: string;
      files: string[];
      clientDir: string;
      stylesheet: string;
    };
    expect(manifest).toMatchObject({
      version: 1,
      webEntry: expect.stringMatching(/^\/assets\/index-[\w-]{8,}\.js$/),
      entry: expect.stringMatching(/^\/assets\/farm-mobile-client-[\w-]{8,}\.js$/),
    });
    expect(manifest.files).toContain(manifest.entry);
    expect(manifest.files).toContain(manifest.webEntry);
    const publicDir = path.join(root, OUTPUT, "public");
    for (const file of manifest.files) {
      await expect(fs.stat(path.join(publicDir, file))).resolves.toBeTruthy();
      await expect(fs.stat(path.join(root, manifest.clientDir, file))).resolves.toBeTruthy();
    }
    // The mobile entry hands navigations to the shell and then runs the web entry; the web entry
    // only consults delegates, of which a browser has none.
    const mobileEntry = await fs.readFile(path.join(publicDir, manifest.entry), "utf8");
    expect(mobileEntry).toContain("offerNavigation");
    expect(mobileEntry).toContain(path.basename(manifest.webEntry));
    const webEntry = await fs.readFile(path.join(publicDir, manifest.webEntry), "utf8");
    expect(webEntry).not.toContain("offerNavigation");

    const port = await startServer(root);
    const web = await send(port, "/");
    expect(web.status).toBe(200);
    expect(web.body).toContain(manifest.webEntry);
    expect(web.body).not.toContain(manifest.entry);
    expect(web.vary).toMatch(/x-farm-shell/i);

    const shell = await send(port, "/", { headers: SHELL });
    expect(shell.status).toBe(200);
    expect(shell.body).toContain(`import("${manifest.entry}")`);
    expect(shell.body).not.toContain(manifest.webEntry);
    expect(shell.body).toContain("count 0");
    expect(shell.cacheControl).toBe("private, no-store");
    expect(shell.vary).toMatch(/x-farm-shell/i);
    // Another page, and a header that is not a shell's, which keeps the web client.
    expect((await send(port, "/notes", { headers: SHELL })).body).toContain(manifest.entry);
    const notShell = await send(port, "/", { headers: { "x-farm-shell": "Android<script>" } });
    expect(notShell.body).toContain(manifest.webEntry);
    expect(notShell.body).not.toContain(manifest.entry);
    // The Flight payload a navigation fetches is not HTML and stays as it is.
    const payload = await send(port, "/notes.rsc", { headers: SHELL });
    expect(payload.status).toBe(200);
    expect(payload.body).not.toContain(manifest.entry);
    expect(payload.vary).not.toMatch(/x-farm-shell/i);

    // The RSC pipeline does not run auth integrations, so there is no device session to trade: a
    // bearer, even with a shell's headers, never gets past a protected page's guard, and the
    // session endpoints do not exist.
    const native = {
      "x-farm-mobile": "com.example.notes",
      authorization: "Bearer fma1.AAAAAAAAAAAAAAAAAAAAAA.secret.key",
    };
    const account = await send(port, "/account", { headers: { ...SHELL, ...native } });
    expect(account.status).toBe(401);
    expect(account.body).not.toContain("ACCOUNT_PAGE");
    const signedIn = await send(port, "/account", { headers: { cookie: "sid=alice-session" } });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body).toContain("ACCOUNT_PAGE");
    const challenge = await send(port, "/__farm/mobile/session/challenge", {
      method: "POST",
      headers: { ...native, cookie: "sid=alice-session" },
    });
    expect(challenge.body).not.toContain("nonce");
  }, 300_000);

  it("adds nothing without a mobile block: no mobile entry, and documents ignore the header", async (ctx) => {
    if (process.platform === "win32") ctx.skip();
    const root = await createApp("");
    // A mobile client an earlier build left must not outlive the block.
    await fs.mkdir(path.join(root, ".farm"), { recursive: true });
    await fs.writeFile(path.join(root, ".farm", "mobile-client.json"), "{}");
    await buildApp(root);
    await expect(fs.stat(path.join(root, ".farm", "mobile-client.json"))).rejects.toThrow();
    const publicFiles = await fs.readdir(path.join(root, OUTPUT, "public"), { recursive: true });
    expect(publicFiles.filter((file) => String(file).includes("farm-mobile-client"))).toEqual([]);
    for (const marker of ["_applyFarmMobileShellClient", "__farm_mobile_shell_client__"]) {
      expect(await serverFilesContaining(root, marker), marker).toEqual([]);
    }
    for (const file of publicFiles.filter((file) => String(file).endsWith(".js"))) {
      const source = await fs.readFile(path.join(root, OUTPUT, "public", String(file)), "utf8");
      expect(source, String(file)).not.toContain("offerNavigation");
    }
    const port = await startServer(root);
    const web = await send(port, "/");
    const shell = await send(port, "/", { headers: SHELL });
    expect(web.vary).not.toMatch(/x-farm-shell/i);
    expect(shell.body).toBe(web.body);
    expect(shell.cacheControl).toBe(web.cacheControl);
  }, 300_000);
});
