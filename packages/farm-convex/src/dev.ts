import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { styleText } from "node:util";
import { definePlugin } from "@farm.js/core/plugin";

import { checkServiceHomes } from "./homes.js";

import type { ConvexDevOptions, ConvexDevState, ConvexFarmConfigView } from "./types.js";
import type { ConvexPluginInput } from "./types.js";

const CONVEX_BINARY = process.platform === "win32" ? "convex.cmd" : "convex";
const OUTPUT_LABEL = "convex │ ";

export function resolveDevOptions(
  dev: boolean | ConvexDevOptions | undefined,
): ConvexDevOptions | undefined {
  if (dev === false) return undefined;
  return dev === true || dev === undefined ? {} : dev;
}

function findConvexBinary(root: string): string | undefined {
  const binaryPath = path.join(root, "node_modules", ".bin", CONVEX_BINARY);
  return existsSync(binaryPath) ? binaryPath : undefined;
}

function readEnvironmentFile(root: string): string {
  try {
    return readFileSync(path.join(root, ".env.local"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

// Before a deployment is chosen, convex dev asks questions on the terminal, so it keeps it.
export function isDeploymentChosen(root: string): boolean {
  if (process.env.CONVEX_DEPLOYMENT || process.env.CONVEX_AGENT_MODE) return true;
  return /^CONVEX_DEPLOYMENT=\S/m.test(readEnvironmentFile(root));
}

function writeLabelledLines(source: NodeJS.ReadableStream, target: NodeJS.WriteStream): void {
  const label = styleText("dim", OUTPUT_LABEL, { stream: target });
  createInterface({ input: source, crlfDelay: Infinity }).on("line", (line) => {
    target.write(`${label}${line}\n`);
  });
}

export function startConvexDev(
  root: string,
  options: ConvexDevOptions,
  state: ConvexDevState,
): void {
  const binaryPath = findConvexBinary(root);
  if (!binaryPath) {
    console.warn(
      "[farm:convex] convex is not installed in this app, so `convex dev` was not started.",
    );
    return;
  }
  const labelOutput = isDeploymentChosen(root);
  const child = spawn(binaryPath, ["dev", ...(options.args ?? [])], {
    cwd: root,
    stdio: labelOutput ? ["inherit", "pipe", "pipe"] : "inherit",
    shell: process.platform === "win32",
    env: labelOutput && process.stdout.isTTY ? { ...process.env, FORCE_COLOR: "1" } : process.env,
  });
  state.child = child;
  if (labelOutput && child.stdout && child.stderr) {
    writeLabelledLines(child.stdout, process.stdout);
    writeLabelledLines(child.stderr, process.stderr);
  }
  const stopWithFarm = () => stopConvexDev(state);
  process.once("exit", stopWithFarm);
  child.once("exit", () => {
    process.off("exit", stopWithFarm);
    // A runner that exits late must not forget the one that replaced it.
    if (state.child === child) state.child = undefined;
  });
}

export function stopConvexDev(state: ConvexDevState | undefined): void {
  if (!state?.child || state.child.exitCode !== null) return;
  state.child.kill("SIGINT");
  state.child = undefined;
}

const DEPLOYMENT_URL_PATTERN = /^(?:VITE_)?CONVEX_URL=\S/m;

/** Tell the developer to restart once convex dev has written the new deployment's URL. */
export function announceNewDeployment(root: string, interval = 500): () => void {
  console.warn(
    "[farm:convex] CONVEX_URL is not set yet. convex dev will create a deployment; restart farm dev when it is ready.",
  );
  // A plain read on a timer, not fs.watchFile: it behaves the same on every platform and in
  // worker threads, and it also sees a URL written before the check started.
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  const check = () => {
    if (!DEPLOYMENT_URL_PATTERN.test(readEnvironmentFile(root))) return false;
    stop();
    console.log("[farm:convex] Convex deployment is ready. Restart farm dev to connect to it.");
    return true;
  };
  if (!check()) {
    timer = setInterval(check, interval);
    timer.unref?.();
  }
  return stop;
}

export function createConvexPlugin(input: ConvexPluginInput) {
  let root = process.cwd();
  return definePlugin<ConvexDevState>({
    name: "farm:convex",
    configure(config) {
      const view = config as ConvexFarmConfigView;
      root = path.resolve(view.root ?? root);
      if (input.waitingForDeployment) return;
      checkServiceHomes({ ...view, root }, input.functionsDirectory, input.homes, input.extensions);
    },
    setup: () => ({}),
    dev: {
      server(_viteServer, { state, lifecycle }) {
        if (input.waitingForDeployment) {
          const stopWatching = announceNewDeployment(root);
          lifecycle.onShutdown(stopWatching);
          if (!input.dev) {
            console.warn(
              "[farm:convex] CONVEX_URL is not set. Run `npx convex dev` to create a deployment.",
            );
            return;
          }
        }
        if (!input.dev) return;
        // Vite closes its HTTP server on every restart (an edited .env does that), and Farm
        // runs this hook once per farm dev, so stop only on shutdown.
        startConvexDev(root, input.dev, state);
        lifecycle.onShutdown(() => stopConvexDev(state));
      },
    },
    runtime: {
      close: ({ state }) => stopConvexDev(state),
    },
  });
}
