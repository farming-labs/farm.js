import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRscNitro, rewriteRscEntryImports } from "./nitro-build";

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), delay(2_000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    // Bounded: Windows maps both signals to TerminateProcess, and waiting forever
    // for an exit event that has already fired turns a failure into a hung run.
    await Promise.race([once(child, "exit"), delay(5_000)]);
    if (child.exitCode === null && child.signalCode === null) {
      throw new Error("Child process did not exit within 5s of SIGKILL");
    }
  }
}

describe("RSC Nitro production build", () => {
  it("rewrites Rolldown entry imports to the copied server bundles", () => {
    const outputRoot = mkdtempSync(path.join(tmpdir(), "farm-rsc-rolldown-"));

    try {
      const serverDir = path.join(outputRoot, "server");
      const serverDistDir = path.join(serverDir, "dist");
      const entryDir = path.join(serverDir, "_build");
      mkdirSync(path.join(serverDistDir, "rsc"), { recursive: true });
      mkdirSync(path.join(serverDistDir, "ssr"), { recursive: true });
      mkdirSync(entryDir, { recursive: true });

      const entryPath = path.join(entryDir, "rsc-entry.mjs");
      writeFileSync(
        entryPath,
        `import "/project/.nitro/vite/dist/rsc/farm-node-env.mjs";
import rsc from "/project/.nitro/vite/dist/rsc/index.js";
globalThis.__VITE_RSC_LOAD_SSR__ = () => import("/project/.nitro/vite/dist/ssr/index.js");`,
      );

      rewriteRscEntryImports(serverDir, serverDistDir);

      const entry = readFileSync(entryPath, "utf-8");
      expect(entry).toContain('import "../dist/rsc/farm-node-env.mjs"');
      expect(entry).toContain('from "../dist/rsc/index.js"');
      expect(entry).toContain('import("../dist/ssr/index.js")');
      expect(entry).not.toContain(".nitro/vite");
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it("boots node-server output after the project and workspace dependencies are removed", async () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "farm-rsc-build-"));
    const isolatedRoot = mkdtempSync(path.join(tmpdir(), "farm-rsc-output-"));
    let child: ChildProcess | undefined;

    try {
      const rscDir = path.join(fixtureRoot, "dist", "rsc");
      const ssrDir = path.join(fixtureRoot, "dist", "ssr");
      const clientDir = path.join(fixtureRoot, "dist", "client");
      mkdirSync(rscDir, { recursive: true });
      mkdirSync(ssrDir, { recursive: true });
      mkdirSync(clientDir, { recursive: true });

      writeFileSync(
        path.join(rscDir, "index.js"),
        `import colors from "picocolors";
import { render } from "@farming-labs/strata";
export default {
  async fetch(request, context) {
    const ssr = await globalThis.__VITE_RSC_LOAD_SSR__();
    const fragment = render({
      type: "document",
      children: [{ type: "element", tag: "strong", children: [{ type: "text", value: "native" }] }],
    });
    return new Response(
      colors.green(ssr.render()) + ":" + fragment.html + ":" + (context?.clientAddress ?? "missing"),
    );
  },
};`,
      );
      writeFileSync(
        path.join(ssrDir, "index.js"),
        `import * as htmlStream from "rsc-html-stream/server";
export function render() {
  return Object.keys(htmlStream).length > 0 ? "standalone-rsc" : "missing-runtime";
}`,
      );
      writeFileSync(path.join(clientDir, "asset.txt"), "production-asset");

      const fixtureModules = path.join(fixtureRoot, "node_modules");
      mkdirSync(fixtureModules, { recursive: true });
      for (const dependency of ["picocolors", "rsc-html-stream"]) {
        symlinkSync(
          realpathSync(path.resolve("node_modules", dependency)),
          path.join(fixtureModules, dependency),
          process.platform === "win32" ? "junction" : "dir",
        );
      }

      const outputDir = path.join(fixtureRoot, ".output");
      await buildRscNitro({
        root: fixtureRoot,
        rendererPath: path.join(rscDir, "index.js"),
        ssrPath: path.join(ssrDir, "index.js"),
        publicDir: clientDir,
        outputDir,
        preset: "node-server",
      });

      const outputPackage = JSON.parse(
        readFileSync(path.join(outputDir, "server", "package.json"), "utf-8"),
      ) as { dependencies?: Record<string, string> };
      expect(outputPackage.dependencies).toMatchObject({
        "@farming-labs/strata": expect.any(String),
        picocolors: expect.any(String),
        "rsc-html-stream": expect.any(String),
      });

      const isolatedOutput = path.join(isolatedRoot, ".output");
      cpSync(outputDir, isolatedOutput, { recursive: true });
      rmSync(fixtureRoot, { recursive: true, force: true });

      const port = await availablePort();
      let logs = "";
      child = spawn(process.execPath, [path.join(isolatedOutput, "server", "index.mjs")], {
        cwd: isolatedRoot,
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: String(port),
          NODE_ENV: "production",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", (chunk) => {
        logs += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        logs += chunk.toString();
      });

      let response: Response | undefined;
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && child.exitCode === null) {
        try {
          response = await fetch(`http://127.0.0.1:${port}/`);
          break;
        } catch {
          await delay(50);
        }
      }

      expect(response, logs).toBeDefined();
      expect(response?.status, logs).toBe(200);
      const body = await response?.text();
      // The handler rebuilds the Request, which has no socket, so it hands the
      // connection's address to the entry for middleware to key on.
      expect(body?.replace(/\u001b\[[0-9;]*m/g, "")).toMatch(
        /^standalone-rsc:<strong>native<\/strong>:(::ffff:)?127\.0\.0\.1$/,
      );
    } finally {
      if (child) await stopProcess(child);
      rmSync(fixtureRoot, { recursive: true, force: true });
      rmSync(isolatedRoot, { recursive: true, force: true });
    }
  }, 60_000);
  it("prerenders the pages the server lists, with their payloads, as static files", async () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "farm-rsc-prerender-"));
    let child: ChildProcess | undefined;

    try {
      const rscDir = path.join(fixtureRoot, "dist", "rsc");
      const ssrDir = path.join(fixtureRoot, "dist", "ssr");
      const clientDir = path.join(fixtureRoot, "dist", "client");
      mkdirSync(rscDir, { recursive: true });
      mkdirSync(ssrDir, { recursive: true });
      mkdirSync(clientDir, { recursive: true });
      // The generated RSC entry's side of the prerender protocol: a seed route that lists the
      // static pages, and pages that queue their payloads, both only during the build.
      writeFileSync(
        path.join(rscDir, "index.js"),
        `export default {
  async fetch(request) {
    const url = new URL(request.url);
    const prerendering = process.env.FARM_RSC_PRERENDER === "1" && request.headers.has("x-nitro-prerender");
    if (prerendering && url.pathname === "/__farm/rsc-prerender-routes") {
      return new Response("<!doctype html>", {
        headers: { "content-type": "text/html; charset=utf-8", "x-nitro-prerender": "%2Fabout" },
      });
    }
    if (url.pathname === "/about.rsc") {
      return new Response("0:payload", { headers: { "content-type": "text/x-component" } });
    }
    const headers = { "content-type": "text/html; charset=utf-8" };
    if (prerendering) headers["x-nitro-prerender"] = "%2Fabout.rsc";
    return new Response("<html>" + url.pathname + (prerendering ? " static" : " dynamic") + "</html>", { headers });
  },
};`,
      );
      writeFileSync(path.join(ssrDir, "index.js"), "export function renderHTML() {}");

      const outputDir = path.join(fixtureRoot, ".output");
      await buildRscNitro({
        root: fixtureRoot,
        rendererPath: path.join(rscDir, "index.js"),
        ssrPath: path.join(ssrDir, "index.js"),
        publicDir: clientDir,
        outputDir,
        preset: "node-server",
      });

      const publicDir = path.join(outputDir, "public");
      expect(readFileSync(path.join(publicDir, "about", "index.html"), "utf-8")).toBe(
        "<html>/about static</html>",
      );
      expect(readFileSync(path.join(publicDir, "about.rsc"), "utf-8")).toBe("0:payload");
      // The seed route leaves nothing behind.
      expect(existsSync(path.join(publicDir, "__farm"))).toBe(false);

      const port = await availablePort();
      child = spawn(process.execPath, [path.join(outputDir, "server", "index.mjs")], {
        cwd: fixtureRoot,
        env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
        stdio: "ignore",
      });
      let about: Response | undefined;
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && child.exitCode === null) {
        try {
          about = await fetch(`http://127.0.0.1:${port}/about`);
          break;
        } catch {
          await delay(50);
        }
      }
      expect(await about?.text()).toBe("<html>/about static</html>");
      const payload = await fetch(`http://127.0.0.1:${port}/about.rsc`);
      expect(payload.headers.get("content-type")).toContain("text/x-component");
      expect(await payload.text()).toBe("0:payload");
      expect(await (await fetch(`http://127.0.0.1:${port}/other`)).text()).toBe(
        "<html>/other dynamic</html>",
      );
      // Nothing outside the build can reach the seed.
      const seed = await fetch(`http://127.0.0.1:${port}/__farm/rsc-prerender-routes`, {
        headers: { "x-nitro-prerender": "/__farm/rsc-prerender-routes" },
      });
      expect(seed.headers.has("x-nitro-prerender")).toBe(false);
    } finally {
      if (child) await stopProcess(child);
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it("prerenders pages that use a runtime package only the plugin depends on", async () => {
    // A strict install (pnpm) does not expose @farming-labs/strata from the app root, and the
    // prerender server runs before the runtime packages are copied next to the server output.
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "farm-rsc-prerender-runtime-"));
    try {
      const rscDir = path.join(fixtureRoot, "dist", "rsc");
      const ssrDir = path.join(fixtureRoot, "dist", "ssr");
      const clientDir = path.join(fixtureRoot, "dist", "client");
      mkdirSync(rscDir, { recursive: true });
      mkdirSync(ssrDir, { recursive: true });
      mkdirSync(clientDir, { recursive: true });
      writeFileSync(
        path.join(rscDir, "index.js"),
        `import { render } from "@farming-labs/strata";
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const prerendering = process.env.FARM_RSC_PRERENDER === "1" && request.headers.has("x-nitro-prerender");
    if (prerendering && url.pathname === "/__farm/rsc-prerender-routes") {
      return new Response("<!doctype html>", {
        headers: { "content-type": "text/html; charset=utf-8", "x-nitro-prerender": "%2Fabout" },
      });
    }
    const fragment = render({
      type: "document",
      children: [{ type: "element", tag: "strong", children: [{ type: "text", value: "native" }] }],
    });
    return new Response("<html>" + fragment.html + "</html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};`,
      );
      writeFileSync(path.join(ssrDir, "index.js"), "export function renderHTML() {}");

      const outputDir = path.join(fixtureRoot, ".output");
      await buildRscNitro({
        root: fixtureRoot,
        rendererPath: path.join(rscDir, "index.js"),
        ssrPath: path.join(ssrDir, "index.js"),
        publicDir: clientDir,
        outputDir,
        preset: "node-server",
      });

      expect(readFileSync(path.join(outputDir, "public", "about", "index.html"), "utf-8")).toBe(
        "<html><strong>native</strong></html>",
      );
      // The links the prerender server used are gone; the server output carries its own copy.
      expect(existsSync(path.join(fixtureRoot, "dist", "node_modules"))).toBe(false);
      expect(
        existsSync(path.join(outputDir, "server", "node_modules", "@farming-labs", "strata")),
      ).toBe(true);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it("fails the build when a listed page fails to prerender", async () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "farm-rsc-prerender-fail-"));

    try {
      const rscDir = path.join(fixtureRoot, "dist", "rsc");
      const ssrDir = path.join(fixtureRoot, "dist", "ssr");
      const clientDir = path.join(fixtureRoot, "dist", "client");
      mkdirSync(rscDir, { recursive: true });
      mkdirSync(ssrDir, { recursive: true });
      mkdirSync(clientDir, { recursive: true });
      writeFileSync(
        path.join(rscDir, "index.js"),
        `export default {
  async fetch(request) {
    if (new URL(request.url).pathname === "/__farm/rsc-prerender-routes") {
      return new Response("<!doctype html>", {
        headers: { "content-type": "text/html", "x-nitro-prerender": "%2Fbroken" },
      });
    }
    return new Response("boom", { status: 500 });
  },
};`,
      );
      writeFileSync(path.join(ssrDir, "index.js"), "export function renderHTML() {}");

      await expect(
        buildRscNitro({
          root: fixtureRoot,
          rendererPath: path.join(rscDir, "index.js"),
          ssrPath: path.join(ssrDir, "index.js"),
          publicDir: clientDir,
          outputDir: path.join(fixtureRoot, ".output"),
          preset: "node-server",
        }),
      ).rejects.toThrow(/Prerendering failed for:\s+\/broken/);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it("runs the bundles in production mode when the deployment leaves NODE_ENV unset", async () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "farm-rsc-node-env-"));
    const children: ChildProcess[] = [];

    try {
      const rscDir = path.join(fixtureRoot, "dist", "rsc");
      const ssrDir = path.join(fixtureRoot, "dist", "ssr");
      const clientDir = path.join(fixtureRoot, "dist", "client");
      mkdirSync(rscDir, { recursive: true });
      mkdirSync(ssrDir, { recursive: true });
      mkdirSync(clientDir, { recursive: true });

      // Both bundles read NODE_ENV while they load, as React's entry files do. The SSR bundle
      // also loads React from node_modules and reports which build that picked.
      writeFileSync(
        path.join(rscDir, "index.js"),
        `const rscMode = process.env.NODE_ENV;
export default {
  async fetch() {
    const ssr = await globalThis.__VITE_RSC_LOAD_SSR__();
    return Response.json({ rsc: rscMode, ssr: ssr.mode, react: ssr.reactBuilds() });
  },
};`,
      );
      writeFileSync(
        path.join(ssrDir, "index.js"),
        `import { createRequire } from "node:module";
import "react";
export const mode = process.env.NODE_ENV;
export function reactBuilds() {
  // Node lists both builds once React's exports are scanned; only the chosen one loads.
  return Object.entries(createRequire(import.meta.url).cache)
    .filter(([, module]) => module.loaded)
    .map(([file]) => file.split(/[\\\\/]/).pop())
    .filter((file) => /^react\\.(development|production)\\.js$/.test(file));
}`,
      );

      const fixtureModules = path.join(fixtureRoot, "node_modules");
      mkdirSync(fixtureModules, { recursive: true });
      symlinkSync(
        realpathSync(path.resolve("node_modules", "react")),
        path.join(fixtureModules, "react"),
        process.platform === "win32" ? "junction" : "dir",
      );

      const outputDir = path.join(fixtureRoot, ".output");
      await buildRscNitro({
        root: fixtureRoot,
        rendererPath: path.join(rscDir, "index.js"),
        ssrPath: path.join(ssrDir, "index.js"),
        publicDir: clientDir,
        outputDir,
        preset: "node-server",
      });

      const request = async (nodeEnv: string | undefined) => {
        const env = { ...process.env, HOST: "127.0.0.1" };
        delete env.NODE_ENV;
        if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
        const port = await availablePort();
        const child = spawn(process.execPath, [path.join(outputDir, "server", "index.mjs")], {
          cwd: fixtureRoot,
          env: { ...env, PORT: String(port) },
          stdio: ["ignore", "pipe", "pipe"],
        });
        children.push(child);
        let logs = "";
        child.stdout?.on("data", (chunk) => {
          logs += chunk.toString();
        });
        child.stderr?.on("data", (chunk) => {
          logs += chunk.toString();
        });
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline && child.exitCode === null) {
          try {
            const response = await fetch(`http://127.0.0.1:${port}/`);
            expect(response.status, logs).toBe(200);
            return await response.json();
          } catch (error) {
            if (!(error instanceof TypeError)) throw error;
            await delay(50);
          }
        }
        throw new Error(`RSC server did not respond: ${logs}`);
      };

      await expect(request(undefined)).resolves.toEqual({
        rsc: "production",
        ssr: "production",
        react: ["react.production.js"],
      });
      // A value the deployment chose is kept.
      await expect(request("staging")).resolves.toMatchObject({ rsc: "staging", ssr: "staging" });
    } finally {
      for (const child of children) await stopProcess(child);
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
