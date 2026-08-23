import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Serializes `prisma generate` across concurrent workspace tasks.
 *
 * Every workspace consumer of the same prisma install shares one physical
 * package directory in the pnpm store, and `prisma generate` copies the query
 * engine into it with a plain rename. When turbo runs two packages' generate
 * at once (both stripe examples under `turbo type-check`/`build`, plus docs),
 * the second rename intermittently fails on Windows with EPERM because the
 * first process still holds the engine file open. One repo-wide lock removes
 * the race for any number of participants.
 */

const STALE_LOCK_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 250;

export async function withPrismaGenerateLock(lockKey, run) {
  const digest = createHash("sha256").update(lockKey).digest("hex").slice(0, 16);
  const lockDirectory = path.join(os.tmpdir(), `farm-prisma-generate-${digest}.lock`);

  for (;;) {
    try {
      fs.mkdirSync(lockDirectory);
      break;
    } catch (error) {
      if (error && error.code !== "EEXIST") throw error;
      let heldSinceMs;
      try {
        heldSinceMs = fs.statSync(lockDirectory).mtimeMs;
      } catch {
        continue; // The holder released between mkdir and stat; retry now.
      }
      if (Date.now() - heldSinceMs > STALE_LOCK_MS) {
        // A crashed holder never releases; break its lock and retry.
        try {
          fs.rmdirSync(lockDirectory);
        } catch {
          // Another waiter broke it first.
        }
        continue;
      }
      await delay(POLL_INTERVAL_MS);
    }
  }

  try {
    return await run();
  } finally {
    try {
      fs.rmdirSync(lockDirectory);
    } catch {
      // Nothing actionable: the stale-lock path may have reclaimed it.
    }
  }
}

function runPrismaGenerate(extraArgs) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    // Windows needs the .cmd shim run through a shell (Node rejects direct
    // .cmd spawns since the CVE-2024-27980 fix).
    const child = spawn(isWindows ? "prisma.cmd" : "prisma", ["generate", ...extraArgs], {
      stdio: "inherit",
      env: process.env,
      shell: isWindows,
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(
        new Error(
          `prisma generate failed with ${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}.`,
        ),
      );
    });
  });
}

const isDirectInvocation =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    await withPrismaGenerateLock(repoRoot, () => runPrismaGenerate(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
