import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import type { MobilePageShells } from "@farm.js/core/mobile";

type ConfigRuntime = typeof import("@farm.js/core/internal/config-runtime");
type MobileRuntime = Awaited<ReturnType<ConfigRuntime["loadFarmMobileRuntime"]>>;

/** A port the OS just handed out, closed again for the server to take. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error("No free port"))));
    });
  });
}

/** Resolves with the server's origin once it prints its listening line; rejects if it exits. */
function waitForListening(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Listening on (https?:\/\/[^\s/]+)/);
      if (match) {
        child.stdout?.off("data", onData);
        child.stderr?.off("data", onData);
        child.off("exit", onExit);
        resolve(match[1]!);
      }
    };
    const onExit = (code: number | null) =>
      reject(
        new Error(`The build's server exited (${code ?? "signal"}) before listening:\n${output}`),
      );
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", reject);
    child.once("exit", onExit);
  });
}

function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

export interface RenderMobilePageShellsOptions {
  root: string;
  os: "android" | "ios";
  runtime: MobileRuntime;
  /** The `--mobile` build's server output (`.farm/output/mobile/www`). */
  outputDir: string;
  /** The build's client output, which holds the stylesheet. */
  clientDir: string;
  /** The token the build's server was built with. */
  token: string;
  basePath: string;
  /** Page route patterns, route groups removed. */
  routes: readonly string[];
  /** The mobile client entry, from `mobile-client.json`. */
  client: string;
  /** Files of the mobile client's manifest; only these stylesheets are inlined. */
  files: readonly string[];
}

/**
 * Start the `--mobile` build's own server on a loopback port, ask it for each route's page shell
 * with the build's token, and stop it. The server decides which routes have one.
 */
export async function renderMobilePageShells(
  options: RenderMobilePageShellsOptions,
): Promise<{ shells: MobilePageShells; skipped: { route: string; reason: string }[] }> {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(options.outputDir, "server", "index.mjs")], {
    cwd: options.root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      NITRO_PORT: String(port),
      HOST: "127.0.0.1",
      NITRO_HOST: "127.0.0.1",
      // Built-in analytics does not count the build's own requests (as for prerendering).
      FARM_PRERENDER: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const origin = await waitForListening(child);
    const bundled = new Set(options.files);
    return await options.runtime.renderFarmMobilePageShells({
      os: options.os,
      routes: options.routes,
      token: options.token,
      basePath: options.basePath,
      client: options.client,
      fetch: (pathname, init) => fetch(`${origin}${pathname}`, { ...init, redirect: "manual" }),
      readStylesheet: (href) => {
        const file =
          options.basePath && href.startsWith(`${options.basePath}/`)
            ? href.slice(options.basePath.length)
            : href;
        if (!bundled.has(file)) return undefined;
        try {
          return readFileSync(path.join(options.clientDir, ...file.slice(1).split("/")), "utf8");
        } catch {
          return undefined;
        }
      },
    });
  } finally {
    await stop(child);
  }
}
