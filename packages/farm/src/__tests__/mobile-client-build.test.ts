// @vitest-environment node

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { readFarmMobileClientManifest, type FarmMobileClientManifest } from "../nitro/mobile-client";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const children = new Set<ChildProcess>();

afterEach(async () => {
  for (const child of children) child.kill("SIGKILL");
  children.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

const MOBILE_BLOCK = `
  mobile: ({ command }) => ({
    id: "com.example.notes",
    server: command === "dev" ? "http://10.0.2.2:3000" : "https://notes.example.com",
  }),`;

const config = (mobile: string) => `export default {
  telemetry: false,
  deploymentId: "fixed",${mobile}
};`;

const page = (label: string) => `"use client";
import { platform } from "@farm.js/core/platform";
export default function Page() {
  return <main>{platform() === "mobile" ? "MOBILE_ONLY_MARKER" : ${JSON.stringify(label)}}</main>;
}`;

async function createApp(mobile: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-mobile-client-"));
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
  const files: Record<string, string> = {
    "package.json": '{"name":"notes","version":"1.0.0","type":"module","private":true}',
    "farm.config.ts": config(mobile),
    "src/app/layout.tsx":
      "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
    "src/app/globals.css": "main { color: rebeccapurple; }",
    "src/app/page.tsx": page("web home"),
    "src/app/notes/page.tsx": "export default function Notes() { return <p>notes</p>; }",
  };
  for (const [file, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), source);
  }
  return root;
}

async function buildApp(root: string): Promise<FarmMobileClientManifest | null> {
  const resolved = await resolveConfig(
    { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
    "production",
  );
  await build(resolved, { root, preset: "node-server" });
  return readFarmMobileClientManifest(path.join(root, ".farm"));
}

async function startServer(root: string): Promise<{ origin: string; stop: () => void }> {
  const port = await getAvailablePort();
  const output: string[] = [];
  const child = spawn(
    process.execPath,
    [path.join(root, ".farm", ".output", "server", "index.mjs")],
    {
      cwd: root,
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.add(child);
  const origin = `http://127.0.0.1:${port}`;
  // Ready once it prints the address it listens on.
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      output.push(String(chunk));
      if (output.join("").includes(`:${port}`)) resolve();
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.once("exit", () => reject(new Error(`server exited:\n${output.join("")}`)));
  });
  return {
    origin,
    stop: () => {
      child.kill("SIGKILL");
      children.delete(child);
    },
  };
}

const SHELL = { "X-Farm-Shell": "android" };

async function clientFile(root: string, file: string): Promise<string> {
  return fs.readFile(path.join(root, ".farm", ".output", "public", file), "utf8");
}

describe("the mobile client in a web build", () => {
  it("is served to mobile shells, and a newer deployment's names miss an older app's bundle", async () => {
    const root = await createApp(MOBILE_BLOCK);
    const manifest = (await buildApp(root))!;
    expect(manifest).toMatchObject({
      version: 1,
      webEntry: expect.stringMatching(/^\/farm-client-h[0-9a-f]{8,}\.js$/),
      entry: expect.stringMatching(/^\/farm-mobile-client-h[0-9a-f]{8,}\.js$/),
      stylesheet: expect.stringMatching(/^\/assets\/farm-client-h[0-9a-f]{8}\.css$/),
    });
    expect(manifest.files).toContain(manifest.entry);
    expect(manifest.files).toContain(manifest.stylesheet);
    // Every bundled file is content-hashed and deployed with the web client.
    for (const file of manifest.files) {
      expect(file).toMatch(/-h[0-9a-f]{8,}\.[a-z0-9]+$/);
      await expect(fs.stat(path.join(root, ".farm", ".output", "public", file))).resolves.toBeTruthy();
    }
    expect(manifest.files).not.toContain(manifest.webEntry);

    // The mobile client hands navigations to the shell and folds platform() to "mobile".
    const mobileSources = (
      await Promise.all(
        manifest.files.filter((file) => file.endsWith(".js")).map((file) => clientFile(root, file)),
      )
    ).join("\n");
    expect(mobileSources).toContain("farm:mobile-shell");
    expect(mobileSources).toContain("MOBILE_ONLY_MARKER");
    const webEntry = await clientFile(root, manifest.webEntry);
    expect(webEntry).not.toContain("farm:mobile-shell");
    expect(webEntry).not.toContain("offerNavigation");

    let server = await startServer(root);
    const web = await fetch(`${server.origin}/`);
    const webHtml = await web.text();
    expect(webHtml).toContain(`src="${manifest.webEntry}"`);
    expect(webHtml).not.toContain(manifest.entry);
    expect(web.headers.get("vary")).toMatch(/X-Farm-Shell/i);

    const shell = await fetch(`${server.origin}/`, { headers: SHELL });
    const shellHtml = await shell.text();
    expect(shellHtml).toContain(`src="${manifest.entry}"`);
    expect(shellHtml).not.toContain(manifest.webEntry);
    expect(shellHtml).toContain(manifest.stylesheet);
    expect(shell.headers.get("cache-control")).toBe("private, no-store");
    expect(shell.headers.get("vary")).toMatch(/X-Farm-Shell/i);
    const entry = await fetch(`${server.origin}${manifest.entry}`);
    expect(entry.status).toBe(200);
    expect(entry.headers.get("content-type")).toMatch(/javascript/);
    // A server page is rewritten the same way.
    expect(await (await fetch(`${server.origin}/notes`, { headers: SHELL })).text()).toContain(
      manifest.entry,
    );
    server.stop();

    // The same source builds the same names, so an app bundled from it serves them locally.
    const again = (await buildApp(root))!;
    expect(again).toEqual(manifest);

    // A newer deployment: its documents reference names the older app's bundle does not have,
    // which the shell then loads from the server.
    await fs.writeFile(path.join(root, "src/app/page.tsx"), page("web home, deployed later"));
    const newer = (await buildApp(root))!;
    expect(newer.entry).not.toBe(manifest.entry);
    server = await startServer(root);
    const newerHtml = await (await fetch(`${server.origin}/`, { headers: SHELL })).text();
    expect(newerHtml).toContain(`src="${newer.entry}"`);
    const referenced = [...newerHtml.matchAll(/(?:src|href)="(\/[^"]+-h[0-9a-f]{8,}\.(?:js|css))"/g)]
      .map((match) => match[1]!);
    const missing = referenced.filter((file) => !manifest.files.includes(file));
    expect(missing).toContain(newer.entry);
    for (const file of missing) {
      expect((await fetch(`${server.origin}${file}`)).status).toBe(200);
    }
    server.stop();
  }, 300_000);

  it("is not built for an app without a mobile block, whose documents ignore the header", async () => {
    const root = await createApp("");
    expect(await buildApp(root)).toBeNull();
    const publicFiles = await fs.readdir(path.join(root, ".farm", ".output", "public"), {
      recursive: true,
    });
    expect(publicFiles.some((file) => String(file).includes("farm-mobile-client"))).toBe(false);
    const server = await startServer(root);
    const web = await fetch(`${server.origin}/`);
    const shell = await fetch(`${server.origin}/`, { headers: SHELL });
    expect(web.headers.get("vary") ?? "").not.toMatch(/X-Farm-Shell/i);
    expect(await shell.text()).toBe(await web.text());
    server.stop();
  }, 300_000);
});
