// `pnpm dev`: run `farm dev` and open it in the Electrobun window.
//
// The window loads the Vite-backed dev server, so HMR, the error overlay and
// Farm devtools work as they do in a browser. Both processes share one
// per-run secret so the dev server enforces the same desktop guard as the
// packaged app. Ctrl+C or closing the window stops both.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";

const port = process.env.PORT ?? "3000";
const devUrl = `http://localhost:${port}`;
const secret = randomBytes(32).toString("base64url");
// electrobun.config.ts copies .farm/.output into the app. The dev window uses
// `farm dev` instead, so an empty folder is enough before the first build.
mkdirSync(".farm/.output", { recursive: true });

const shared = { ...process.env, FARM_DESKTOP_SECRET: secret, FARM_DESKTOP_PORT: port };

const isWindows = process.platform === "win32";
const children = new Set();
function run(command, args, env) {
  // Own process group on macOS/Linux, so stopping also reaches the app that
  // `electrobun dev` launches (it outlives its CLI wrapper otherwise).
  const child = spawn(command, args, { env, stdio: "inherit", shell: isWindows, detached: !isWindows });
  children.add(child);
  child.on("error", (error) => {
    console.error(`[dev] could not start ${command}: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code) => {
    children.delete(child);
    stop(code ?? 0);
  });
  return child;
}

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      if (isWindows) child.kill();
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  process.exitCode = code;
}
process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));

async function waitForDevServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (!stopping) {
    try {
      await fetch(devUrl, { method: "HEAD" });
      return true;
    } catch {
      if (Date.now() > deadline) throw new Error(`farm dev did not answer on ${devUrl}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  return false;
}

run("farm", ["dev", "--port", port], shared);
if (await waitForDevServer()) {
  run("electrobun", ["dev"], { ...shared, FARM_DESKTOP_DEV_URL: devUrl });
}
