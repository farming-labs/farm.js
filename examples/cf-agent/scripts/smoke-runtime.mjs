import { AgentClient } from "agents/client";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function runAgentRuntimeSmoke(options) {
  const port = await availablePort();
  const origin = `http://localhost:${port}`;
  let output = "";
  let client;

  const runtime = spawn(options.command, options.args(port), {
    cwd: root,
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  for (const stream of [runtime.stdout, runtime.stderr]) {
    stream?.on("data", (chunk) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-64_000);
    });
  }

  try {
    const page = await waitForResponse(runtime, origin, 90_000);
    const html = await page.text();
    if (!page.ok || !html.includes("Persistent counter agent")) {
      throw new Error(
        `Farm page did not render through ${origin} (${page.status}): ${html.slice(0, 500)}`,
      );
    }

    client = new AgentClient({
      agent: "CounterAgent",
      name: `${options.instancePrefix}-${Date.now()}`,
      host: `localhost:${port}`,
      protocol: "ws",
      defaultCallTimeout: 10_000,
    });
    await withTimeout(
      client.ready,
      30_000,
      "Cloudflare Agent WebSocket did not identify itself.",
    );
    await client.stub.reset();
    const count = await client.stub.increment();
    if (count !== 1 || client.state?.count !== 1) {
      throw new Error(`Cloudflare Agent RPC returned an unexpected count: ${String(count)}.`);
    }

    return origin;
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    client?.close(1000, "Smoke test complete");
    await stop(runtime);
  }
}

async function waitForResponse(runtime, url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (runtime.exitCode !== null || runtime.signalCode !== null) {
      throw new Error(`Runtime exited before ${url} became ready.`);
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
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
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

async function withTimeout(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
