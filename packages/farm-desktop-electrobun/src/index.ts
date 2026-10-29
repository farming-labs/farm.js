import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  defineDesktopShell,
  type DesktopDevSession,
  type DesktopShellContext,
} from "@farm.js/core/desktop";
import { createElectrobunConfig, createElectrobunMain } from "./templates.js";

export { createElectrobunConfig, createElectrobunMain } from "./templates.js";

const isWindows = process.platform === "win32";

/**
 * The `electrobun` bootstrap installed in the app, which runs Hutch's Electrobun toolchain.
 * Looked up in the app's node_modules folders only, like a package bin.
 */
export function resolveElectrobunCli(root: string): string {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const cli = path.join(dir, "node_modules", "electrobun", "bin", "electrobun.cjs");
    if (existsSync(cli)) return cli;
    if (path.dirname(dir) === dir) break;
  }
  throw Object.assign(
    new Error(
      `@farm.js/desktop-electrobun needs the electrobun package in ${root}. Install it next to the adapter, for example:\n  pnpm add -D electrobun`,
    ),
    { name: "FarmDesktopError", code: "shell-missing" },
  );
}

function runElectrobun(context: DesktopShellContext, args: string[], env?: NodeJS.ProcessEnv) {
  // Its own process group on macOS and Linux, so stopping also reaches the app that
  // `electrobun dev` launches, which outlives the CLI wrapper otherwise.
  return spawn(process.execPath, [resolveElectrobunCli(context.root), ...args], {
    cwd: context.shellDir,
    env: env ?? process.env,
    stdio: "inherit",
    detached: !isWindows,
  });
}

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

function stopProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  try {
    if (isWindows) child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
}

/** Move Electrobun's build and artifact folders into Farm's dist directory. */
async function collectArtifacts(shellDir: string, distDir: string): Promise<string[]> {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  const files: string[] = [];
  const buildRoot = path.join(shellDir, "build");
  for (const target of existsSync(buildRoot) ? await readdir(buildRoot) : []) {
    if (!target.startsWith("stable-")) continue;
    for (const entry of await readdir(path.join(buildRoot, target))) {
      const destination = path.join(distDir, entry);
      await rename(path.join(buildRoot, target, entry), destination);
      files.push(destination);
    }
  }
  const artifactRoot = path.join(shellDir, "artifacts");
  if (existsSync(artifactRoot)) {
    const updateDir = path.join(distDir, "update");
    await mkdir(updateDir, { recursive: true });
    for (const entry of await readdir(artifactRoot)) {
      const destination = path.join(updateDir, entry);
      await rename(path.join(artifactRoot, entry), destination);
      files.push(destination);
    }
  }
  return files;
}

export default defineDesktopShell({
  name: "electrobun",
  runtime: "bun",

  generateMain(context) {
    return [
      { path: "electrobun.config.ts", contents: createElectrobunConfig(context) },
      { path: "main.ts", contents: createElectrobunMain(context) },
    ];
  },

  async dev(context): Promise<DesktopDevSession> {
    // The config copies the server output into the app; dev never reads it, but it must exist.
    await mkdir(context.serverDir, { recursive: true });
    const child = runElectrobun(context, ["dev"], context.env);
    const exited = waitForExit(child);
    return {
      exited,
      async close() {
        stopProcessTree(child, "SIGTERM");
        const timer = setTimeout(() => stopProcessTree(child, "SIGKILL"), 5_000);
        await exited.catch(() => 1);
        clearTimeout(timer);
      },
    };
  },

  async package(context) {
    const code = await waitForExit(runElectrobun(context, ["build", "--env=stable"]));
    if (code !== 0) throw new Error(`electrobun build exited with code ${code}.`);
    return { files: await collectArtifacts(context.shellDir, context.distDir) };
  },
});
