import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = await availablePort();
const origin = `http://localhost:${port}`;
let output = "";

const farm = spawn("farm", ["dev", "--port", String(port)], {
  cwd: root,
  env: {
    ...process.env,
    NO_COLOR: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

for (const stream of [farm.stdout, farm.stderr]) {
  stream?.on("data", (chunk) => {
    output = `${output}${chunk.toString("utf8")}`.slice(-32_768);
  });
}

try {
  const health = await waitForResponse(`${origin}/eve/v1/health`, 180_000);
  if (!health.ok) throw new Error(`Eve health returned ${health.status}.`);

  const page = await waitForResponse(origin, 30_000);
  const html = await page.text();
  if (!page.ok || !html.includes("Support agent")) {
    throw new Error(`Farm page did not render through ${origin}.`);
  }

  console.log(`Farm and Eve are healthy at ${origin}`);
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await stop(farm);
}

async function waitForResponse(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (farm.exitCode !== null || farm.signalCode !== null) {
      throw new Error(`Farm exited before ${url} became ready.`);
    }
    try {
      return await fetch(url, { signal: AbortSignal.timeout(1_000) });
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    }
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

async function availablePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "localhost", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate a port."));
        return;
      }
      server.close((error) =>
        error ? reject(error) : resolvePort(address.port),
      );
    });
  });
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolveExit) => child.once("exit", () => resolveExit(true))),
    new Promise((resolveExit) => setTimeout(() => resolveExit(false), 5_000)),
  ]);
  if (!exited) child.kill("SIGKILL");
}
