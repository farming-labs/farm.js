import { createServer as createNetServer } from "node:net";

/**
 * Reserve a free TCP port for a test dev server.
 *
 * `server.listen(0)` looks like "let the OS pick a port", but Vite treats 0 as an
 * unset port and falls back to its own default (5173) instead of the configured
 * one. Farm's dev server also sets `strictPort: true`, so the fallback does not
 * drift upward either: every suite that calls `listen(0)` lands on 5173 and the
 * second one to start fails with "Port 5173 is already in use" once vitest runs
 * their files in parallel.
 *
 * Binding an explicit port avoids that. There is a small window between closing
 * this probe socket and the dev server binding, which is the same tradeoff the
 * production server tests already make.
 */
export async function getAvailablePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  if (port === 0) throw new Error("Could not reserve a free port for the test dev server.");
  return port;
}
