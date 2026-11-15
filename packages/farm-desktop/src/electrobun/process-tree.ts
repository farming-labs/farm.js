import { spawnSync, type ChildProcess } from "node:child_process";

/**
 * Stop the Electrobun CLI and the app it launched. On macOS and Linux the CLI leads its own
 * process group, so the signal reaches the whole group. Windows has neither process groups nor
 * signals for another process, and kill() would end only the CLI, so taskkill ends the tree.
 */
export function stopProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals,
  platform: NodeJS.Platform = process.platform,
): void {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  try {
    if (platform !== "win32") {
      process.kill(-child.pid, signal);
      return;
    }
    const result = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (result.error || result.status !== 0) child.kill(signal);
  } catch {
    // Already gone.
  }
}
