import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  cpSync,
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
        `import rsc from "/project/.nitro/vite/dist/rsc/index.js";
globalThis.__VITE_RSC_LOAD_SSR__ = () => import("/project/.nitro/vite/dist/ssr/index.js");`,
      );

      rewriteRscEntryImports(serverDir, serverDistDir);

      const entry = readFileSync(entryPath, "utf-8");
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
});
