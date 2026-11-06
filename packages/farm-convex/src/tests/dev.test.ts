import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventEmitter } from "node:events";

import {
  createConvexPlugin,
  isDeploymentChosen,
  resolveDevOptions,
  startConvexDev,
  stopConvexDev,
} from "../dev.js";

import type { ConvexDevState } from "../types.js";

const FAKE_CONVEX = `#!/bin/sh
echo "$@" > "$(dirname "$0")/../../arguments.txt"
echo "Convex functions ready!"
echo "function failed" >&2
trap 'echo stopped > "$(dirname "$0")/../../stopped.txt"; exit 0' INT
while true; do sleep 0.05; done
`;

function createAppWithFakeConvex(): string {
  const root = mkdtempSync(path.join(tmpdir(), "farm-convex-dev-"));
  const binaryDirectory = path.join(root, "node_modules", ".bin");
  mkdirSync(binaryDirectory, { recursive: true });
  writeFileSync(path.join(binaryDirectory, "convex"), FAKE_CONVEX);
  chmodSync(path.join(binaryDirectory, "convex"), 0o755);
  return root;
}

function waitFor(check: () => boolean): Promise<void> {
  return vi.waitFor(() => expect(check()).toBe(true), { timeout: 5000, interval: 50 });
}

function readTextFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

describe("resolveDevOptions", () => {
  it("runs convex dev unless the app turns it off", () => {
    expect(resolveDevOptions(undefined)).toEqual({});
    expect(resolveDevOptions(true)).toEqual({});
    expect(resolveDevOptions(false)).toBeUndefined();
    expect(resolveDevOptions({ args: ["--tail-logs", "disable"] })).toEqual({
      args: ["--tail-logs", "disable"],
    });
  });
});

describe("isDeploymentChosen", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("waits for a deployment before labelling output, so first-run questions keep the terminal", () => {
    vi.stubEnv("CONVEX_DEPLOYMENT", "");
    vi.stubEnv("CONVEX_AGENT_MODE", "");
    const root = mkdtempSync(path.join(tmpdir(), "farm-convex-env-"));
    expect(isDeploymentChosen(root)).toBe(false);
    writeFileSync(path.join(root, ".env.local"), "CONVEX_DEPLOYMENT=dev:superb-impala-637\n");
    expect(isDeploymentChosen(root)).toBe(true);
  });

  it("treats a deployment from the environment as chosen", () => {
    vi.stubEnv("CONVEX_AGENT_MODE", "anonymous");
    expect(isDeploymentChosen(mkdtempSync(path.join(tmpdir(), "farm-convex-env-")))).toBe(true);
  });
});

describe.skipIf(process.platform === "win32")("convex dev runner", () => {
  const state: ConvexDevState = {};

  afterEach(() => stopConvexDev(state));

  it("starts convex dev with the app's arguments and stops it on shutdown", async () => {
    const root = createAppWithFakeConvex();
    startConvexDev(root, { args: ["--typecheck", "disable"] }, state);
    await waitFor(
      () => readTextFile(path.join(root, "arguments.txt")).trim() === "dev --typecheck disable",
    );
    stopConvexDev(state);
    await waitFor(() => readTextFile(path.join(root, "stopped.txt")).trim() === "stopped");
    expect(state.child).toBeUndefined();
  });

  it("labels each line convex prints once a deployment is chosen", async () => {
    const root = createAppWithFakeConvex();
    writeFileSync(path.join(root, ".env.local"), "CONVEX_DEPLOYMENT=dev:superb-impala-637\n");
    const printed: string[] = [];
    const record = (chunk: string | Uint8Array) => printed.push(String(chunk)) > 0;
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(record);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(record);
    startConvexDev(root, {}, state);
    await waitFor(() => printed.length === 2);
    stdout.mockRestore();
    stderr.mockRestore();
    expect(printed.toSorted()).toEqual([
      "convex │ Convex functions ready!\n",
      "convex │ function failed\n",
    ]);
  });

  it("keeps convex dev running when Vite restarts and stops it when Farm shuts down", async () => {
    const runner: ConvexDevState = {};
    const root = createAppWithFakeConvex();
    const plugin = createConvexPlugin({
      dev: {},
      homes: {},
      functionsDirectory: "convex",
      extensions: [],
    });
    const configure = plugin.configure as (config: object, context: object) => void;
    configure({ root, integrations: {} }, {});
    const httpServer = new EventEmitter();
    const shutdownHooks: Array<() => void> = [];
    const lifecycle = { onShutdown: (hook: () => void) => shutdownHooks.push(hook) };
    const server = plugin.dev?.server as (vite: object, context: object) => void;
    try {
      server({ httpServer }, { state: runner, lifecycle });
      await waitFor(() => readTextFile(path.join(root, "arguments.txt")).trim() === "dev");

      // Vite closes the old HTTP server on every restart, such as after an .env edit.
      httpServer.emit("close");
      expect(runner.child?.exitCode).toBeNull();
      expect(readTextFile(path.join(root, "stopped.txt"))).toBe("");

      shutdownHooks.forEach((hook) => hook());
      await waitFor(() => readTextFile(path.join(root, "stopped.txt")).trim() === "stopped");
    } finally {
      stopConvexDev(runner);
    }
  });

  it("warns and carries on when convex is not installed", () => {
    const root = mkdtempSync(path.join(tmpdir(), "farm-convex-missing-"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    startConvexDev(root, {}, state);
    expect(state.child).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("convex is not installed"));
    warn.mockRestore();
  });
});
