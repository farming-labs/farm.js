import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { getAvailablePort } from "./dev-server-port";

export interface ProductionServer {
  /** `http://127.0.0.1:<port>`, without the app's base path. */
  origin: string;
  port: number;
  process: ChildProcess;
  /** Everything the server wrote to stdout and stderr so far. */
  output: () => string;
  /** Stop the server and wait for it to exit, so Windows releases the output directory. */
  stop: () => Promise<void>;
}

export interface StartProductionServerOptions {
  /** Added to the parent's environment. HOST and PORT are always the helper's. */
  env?: NodeJS.ProcessEnv;
  /** The runtime that runs the entry. Defaults to the current Node binary. */
  command?: string;
  /** Picks a candidate port. Only tests of this helper replace it. */
  getPort?: () => Promise<number>;
}

const MAX_PORT_ATTEMPTS = 5;
const READY_TIMEOUT_MS = 30_000;

/**
 * Start a built `node-server` (or `bun`) output and resolve once it listens.
 *
 * The production entry cannot bind port 0 (it treats `PORT=0` as unset and falls back to
 * 3000), so the port has to be picked first and is free for a moment before the child
 * binds it. Another test file running in parallel can take it in that moment, for example
 * a mock upstream that calls `listen(0)`. Polling the port with `fetch` then reaches that
 * other server and the test reads its responses as the app's.
 *
 * Readiness is therefore the server's own line for the exact port, which it prints only
 * after its own listen succeeded: the production entry's `Listening on`, or the `Local:`
 * banner of a script that starts `@farm.js/core/server` itself. If the child instead exits
 * because the port is in use, it lost the port, and the helper starts it again on a new one.
 */
export async function startProductionServer(
  serverDirectory: string,
  options: StartProductionServerOptions = {},
): Promise<ProductionServer> {
  for (let attempt = 1; ; attempt++) {
    const port = await (options.getPort ?? getAvailablePort)();
    const result = await spawnOnPort(serverDirectory, port, options);
    if ("server" in result) return result.server;
    if (!result.portInUse || attempt >= MAX_PORT_ATTEMPTS) throw result.error;
  }
}

function spawnOnPort(
  serverDirectory: string,
  port: number,
  options: StartProductionServerOptions,
): Promise<{ server: ProductionServer } | { error: Error; portInUse: boolean }> {
  const chunks: string[] = [];
  const output = () => chunks.join("");
  const child = spawn(
    options.command ?? process.execPath,
    [path.join(serverDirectory, "index.mjs")],
    {
      cwd: serverDirectory,
      env: { ...process.env, ...options.env, HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const exited = new Promise<void>((resolve) => {
    if (hasExited(child)) resolve();
    else child.once("exit", () => resolve());
  });
  // Only this child's own line counts: `:30001` must not match a wait for `:3000`. The
  // `Local:` banner is colored, so escape codes can sit between the label and the URL.
  const ready = new RegExp(
    `(?:Listening on https?://127\\.0\\.0\\.1|Local:.*https?://localhost):${port}(?!\\d)`,
  );

  return new Promise((resolve) => {
    let settled = false;
    const settle = (
      result: { server: ProductionServer } | { error: Error; portInUse: boolean },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    // The first failure names the cause: stopping the child after a timeout fires "close" too.
    let failing = false;
    const fail = async (message: string, portInUse = false) => {
      if (settled || failing) return;
      failing = true;
      await stop();
      settle({ error: new Error(`${message}\n${output()}`), portInUse });
    };
    const stop = async () => {
      if (hasExited(child)) return;
      child.kill("SIGTERM");
      let forceTimer: NodeJS.Timeout | undefined;
      await Promise.race([
        exited,
        new Promise<void>((done) => {
          forceTimer = setTimeout(done, 5_000);
        }),
      ]);
      clearTimeout(forceTimer);
      if (!hasExited(child)) {
        child.kill("SIGKILL");
        await exited;
      }
    };

    const timeout = setTimeout(
      () =>
        void fail(
          `Production server did not listen on port ${port} within ${READY_TIMEOUT_MS} ms.`,
        ),
      READY_TIMEOUT_MS,
    );
    child.stdout.on("data", (chunk) => {
      chunks.push(String(chunk));
      if (!settled && ready.test(output())) {
        settle({
          server: { origin: `http://127.0.0.1:${port}`, port, process: child, output, stop },
        });
      }
    });
    child.stderr.on("data", (chunk) => chunks.push(String(chunk)));
    child.once("error", (error) => {
      // A child that never started emits no "exit" to wait for.
      if (child.pid === undefined) {
        failing = true;
        settle({
          error: new Error(`Production server failed to spawn: ${error.message}`),
          portInUse: false,
        });
      } else void fail(`Production server failed: ${error.message}`);
    });
    // "close" rather than "exit": it fires after stdio drained, so the error is in output().
    child.once("close", (code, signal) => {
      void fail(
        `Production server exited (${signal ?? code}) before listening on port ${port}.`,
        /EADDRINUSE|is already in use/.test(output()),
      );
    });
  });
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}
