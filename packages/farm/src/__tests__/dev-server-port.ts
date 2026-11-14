import { createServer as createNetServer } from "node:net";

/**
 * Below the OS ephemeral range on every CI platform: Linux assigns `listen(0)` and outgoing
 * connections ports from 32768, Windows and macOS from 49152.
 */
const FIRST_PORT = 20_000;
const LAST_PORT = 32_767;
const MAX_PROBES = 50;

/**
 * Reserve a free TCP port for a test server.
 *
 * `server.listen(0)` looks like "let the OS pick a port", but Vite treats 0 as an
 * unset port and falls back to its own default (5173) instead of the configured
 * one. Farm's dev server also sets `strictPort: true`, so the fallback does not
 * drift upward either: every suite that calls `listen(0)` lands on 5173 and the
 * second one to start fails with "Port 5173 is already in use" once vitest runs
 * their files in parallel. The production entry likewise treats `PORT=0` as unset.
 *
 * So the port is picked here and is free between this probe closing and the server
 * binding it. Taking the probe's port from `listen(0)` made that window a race with every
 * other test file: their mock upstreams and helper servers do call `listen(0)`, and the OS
 * hands the port that was just freed to one of them. Picking from outside the ephemeral
 * range leaves only another caller of this helper choosing the same random port in the
 * same moment. `startProductionServer` also retries when it loses the port anyway.
 */
export async function getAvailablePort(): Promise<number> {
  let lastError: unknown;
  for (let probe = 0; probe < MAX_PROBES; probe++) {
    const port = FIRST_PORT + Math.floor(Math.random() * (LAST_PORT - FIRST_PORT + 1));
    try {
      await probePort(port);
      return port;
    } catch (error) {
      // In use, or reserved by the OS (Windows excludes ranges for Hyper-V): try another.
      lastError = error;
    }
  }
  throw new Error(`Could not reserve a free port for a test server: ${String(lastError)}`);
}

async function probePort(port: number): Promise<void> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
