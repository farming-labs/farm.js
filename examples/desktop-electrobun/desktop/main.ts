import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, BuildConfig, PATHS, Utils } from "electrobun/main";

// Electrobun main process. In a packaged build it starts the Farm server that
// `farm build --preset bun` produced, on 127.0.0.1 and a random port, then
// opens a native window on it. Under `pnpm dev` it opens the window on the
// running `farm dev` server instead, so HMR and the error overlay work.

const HANDSHAKE_PATH = "/__desktop/handshake";

function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Could not reserve a loopback port"));
      });
    });
  });
}

async function waitForServer(origin: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      // Any HTTP answer means the server is listening; the guard answers 403
      // without the session cookie, which is fine here.
      await fetch(`${origin}/`, { method: "HEAD" });
      return;
    } catch (error) {
      if (Date.now() > deadline) throw new Error(`Farm server did not start: ${String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function startEmbeddedServer(): Promise<{ origin: string; secret: string }> {
  const port = await freeLoopbackPort();
  const secret = randomBytes(32).toString("base64url");
  const dataDir = Utils.paths.userData;
  await mkdir(dataDir, { recursive: true });

  // Nitro's bun preset reads NITRO_PORT/PORT and NITRO_HOST/HOST at import.
  Object.assign(process.env, {
    NODE_ENV: "production",
    NITRO_HOST: "127.0.0.1",
    NITRO_PORT: String(port),
    HOST: "127.0.0.1",
    PORT: String(port),
    FARM_DESKTOP_SECRET: secret,
    FARM_DESKTOP_PORT: String(port),
    FARM_DESKTOP_DATA_DIR: dataDir,
  });

  const entry = join(PATHS.RESOURCES_FOLDER, "app", "farm", "server", "index.mjs");
  await import(pathToFileURL(entry).href);

  const origin = `http://127.0.0.1:${port}`;
  await waitForServer(origin);
  console.log(`[desktop] Farm server on ${origin}, data in ${dataDir}`);
  return { origin, secret };
}

async function resolveApp(): Promise<{ origin: string; secret: string }> {
  const build = await BuildConfig.get();
  const devUrl = process.env.FARM_DESKTOP_DEV_URL;
  const devSecret = process.env.FARM_DESKTOP_SECRET;
  if (!build.isPackaged && devUrl && devSecret) {
    await waitForServer(devUrl);
    console.log(`[desktop] using farm dev at ${devUrl}`);
    return { origin: devUrl, secret: devSecret };
  }
  return startEmbeddedServer();
}

const { origin, secret } = await resolveApp();

const win = new BrowserWindow({
  title: "Farm Notes",
  url: `${origin}${HANDSHAKE_PATH}?token=${encodeURIComponent(secret)}`,
  frame: { width: 900, height: 700 },
});

// Keep the window on the app's own origin. Last matching rule wins.
win.webview.setNavigationRules(["^*", `${origin}/*`]);
