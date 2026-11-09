// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

async function writeModule(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

// A root-level dynamic route matches any single-segment path, including one written with
// repeated leading slashes, so it reaches the trailing-slash canonical redirect.
async function createDynamicRootProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-trailing-slash-redirect-"));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const pkg of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
      path.join(root, "node_modules", pkg),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await writeModule(
    root,
    "src/app/layout.tsx",
    `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }`,
  );
  await writeModule(
    root,
    "src/app/page.tsx",
    `import React from "react";
export default function Page() { return <main>home</main>; }`,
  );
  await writeModule(
    root,
    "src/app/[slug]/page.tsx",
    `import React from "react";
export default function Page({ params }) { return <main>slug {params.slug}</main>; }`,
  );
  await writeModule(
    root,
    "src/app/[slug]/about/page.tsx",
    `import React from "react";
export default function Page() { return <main>nested about</main>; }`,
  );
  return root;
}

interface RawResponse {
  status: number;
  location: string | undefined;
}

// node:http sends the request target verbatim; fetch() would normalize "/\\" to "//" first.
function requestRaw(port: number, target: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port, path: target, method: "GET", headers: { accept: "text/html" } },
      (response) => {
        response.resume();
        response.once("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location,
          }),
        );
      },
    );
    request.once("error", reject);
    request.end();
  });
}

async function withProductionServer(
  root: string,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const serverDir = path.join(root, ".farm", ".output", "server");
  const port = await getAvailablePort();
  const processOutput: string[] = [];
  const child = spawn(process.execPath, [path.join(serverDir, "index.mjs")], {
    cwd: serverDir,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => processOutput.push(String(chunk)));
  child.stderr.on("data", (chunk) => processOutput.push(String(chunk)));
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));

  try {
    let ready = false;
    for (let attempt = 0; attempt < 200 && !ready; attempt++) {
      if (child.exitCode !== null) break;
      ready = await fetch(`http://127.0.0.1:${port}/_farm/health/ready`).then(
        (response) => response.ok,
        () => false,
      );
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(ready, processOutput.join("")).toBe(true);
    await run(port);
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
  }
}

function expectSameOriginLocation(response: RawResponse, target: string): void {
  if (response.status >= 300 && response.status < 400) {
    expect(response.location, target).toBeDefined();
    expect(response.location!, target).toMatch(/^\/(?![/\\])/);
  }
}

describe("production trailing-slash redirects", () => {
  it("collapses leading slashes when trailingSlash is false", async () => {
    const root = await createDynamicRootProject();
    const config = await resolveConfig(
      { root, trailingSlash: false, images: { provider: "none" } },
      "production",
    );
    await build(config, { root, preset: "node-server" });

    await withProductionServer(root, async (port) => {
      const expected: Array<[string, string]> = [
        ["//evil.com/", "/evil.com"],
        ["/\\evil.com/", "/evil.com"],
        ["///evil.com/", "/evil.com"],
        ["//evil.com/?x=1", "/evil.com?x=1"],
      ];
      for (const [target, location] of expected) {
        const response = await requestRaw(port, target);
        expectSameOriginLocation(response, target);
        expect(response, target).toEqual({ status: 308, location });
      }

      // Already canonical, so it renders the dynamic route without a redirect, as before.
      expect(await requestRaw(port, "//evil.com")).toEqual({ status: 200, location: undefined });

      // Ordinary canonicalization is unchanged.
      expect(await requestRaw(port, "/about/")).toEqual({ status: 308, location: "/about" });
      expect(await requestRaw(port, "/about/?tab=team")).toEqual({
        status: 308,
        location: "/about?tab=team",
      });
      expect((await requestRaw(port, "/about")).status).toBe(200);
      expect((await requestRaw(port, "/")).status).toBe(200);
    });
  }, 240_000);

  it("collapses leading slashes when trailingSlash is true", async () => {
    const root = await createDynamicRootProject();
    const config = await resolveConfig(
      { root, trailingSlash: true, images: { provider: "none" } },
      "production",
    );
    await build(config, { root, preset: "node-server" });

    await withProductionServer(root, async (port) => {
      const expected: Array<[string, string]> = [
        ["//evil.com", "/evil.com/"],
        ["/\\evil.com", "/evil.com/"],
        ["//evil.com/about", "/evil.com/about/"],
      ];
      for (const [target, location] of expected) {
        const response = await requestRaw(port, target);
        expectSameOriginLocation(response, target);
        expect(response, target).toEqual({ status: 308, location });
      }

      expect(await requestRaw(port, "//evil.com/")).toEqual({ status: 200, location: undefined });

      expect(await requestRaw(port, "/about")).toEqual({ status: 308, location: "/about/" });
      expect(await requestRaw(port, "/about?tab=team")).toEqual({
        status: 308,
        location: "/about/?tab=team",
      });
      expect((await requestRaw(port, "/about/")).status).toBe(200);
      expect((await requestRaw(port, "/")).status).toBe(200);
    });
  }, 240_000);
});
