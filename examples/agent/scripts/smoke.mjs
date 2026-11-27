import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
let output = "";

const production = process.argv.includes("--production");
const args = production
  ? [resolve(root, ".farm/.output/server/index.mjs")]
  : ["dev", "--host", "127.0.0.1", "--port", String(port)];
const farm = spawn(production ? process.execPath : "farm", args, {
  cwd: root,
  env: {
    ...process.env,
    NO_COLOR: "1",
    HOST: "127.0.0.1",
    PORT: String(port),
    AGENT_DATA: ".data/smoke",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

for (const stream of [farm.stdout, farm.stderr]) {
  stream?.on("data", (chunk) => {
    output = `${output}${chunk.toString("utf8")}`.slice(-32_768);
  });
}

try {
  const manifest = await (
    await waitForResponse(`${origin}/api/agent/manifest.json`, 60_000)
  ).json();
  if (!manifest.agents?.some((agent) => agent.name === "refund")) {
    throw new Error(`The refund agent is missing from ${JSON.stringify(manifest)}.`);
  }

  const quoteResponse = await fetch(`${origin}/api/examples/quote?quantity=3`);
  assert.equal(quoteResponse.status, 200);
  const quote = await quoteResponse.json();
  assert.equal(quote.totalCents, 3600);
  const invalid = await fetch(`${origin}/api/examples/quote?quantity=0`);
  assert.equal(invalid.status, 400);

  const packingUrl = `${origin}/api/examples/packing`;
  const planResponse = await fetch(`${packingUrl}?quantity=${quote.quantity}`);
  if (process.env.FARM_CHECKOUT_POLYROUTE === "1") {
    assert.equal(planResponse.status, 200);
    const plan = await planResponse.json();
    assert.deepEqual(plan, { quantity: quote.quantity, bagsPerBox: 4, boxes: 1 });
    const larger = await fetch(`${packingUrl}?quantity=5`);
    assert.equal((await larger.json()).boxes, 2);
    for (const query of ["", "?quantity=0", "?quantity=21", "?quantity=1&quantity=2"]) {
      assert.equal((await fetch(packingUrl + query)).status, 400, query);
    }
    const unsupported = await fetch(packingUrl, { method: "POST" });
    assert.equal(unsupported.status, 405);
    assert.equal(unsupported.headers.get("allow"), "GET");
    console.log(`Rust packing plan: ${plan.quantity} bags in ${plan.boxes} box.`);
  } else {
    assert.equal(planResponse.status, 404);
  }

  // Use a fresh order so a retained payment event from an earlier run cannot match.
  const orderId = randomUUID();
  const checkout = await post("/api/agent/agents/checkout/runs", { input: { orderId } });
  await waitForStatus(checkout.id, "waiting");
  console.log("Checkout is waiting for payment.");

  await post("/api/agent/events", {
    id: `payment-${orderId}`,
    name: "payment.succeeded",
    data: { orderId, amount: quote.totalCents },
  });
  const paid = await waitForStatus(checkout.id, "completed");
  assert.deepEqual(paid.output, { orderId, paid: 3600 });
  console.log("Checkout recorded the demo payment of 3600 cents.");

  const started = await post("/api/agent/agents/refund/runs", { input: { orderId } });
  const paused = await waitForStatus(started.id, "interrupted");
  if (paused.interrupt?.name !== "approve-refund") {
    throw new Error(`The run paused on ${JSON.stringify(paused.interrupt)}, not approve-refund.`);
  }
  await post(`/api/agent/runs/${started.id}/resume`, { answer: { approved: true } });
  const finished = await waitForStatus(started.id, "completed");
  if (finished.output !== `refunded ${orderId}`)
    throw new Error(`The run finished with ${finished.output}.`);

  console.log(`The refund agent paused for approval and finished at ${origin}`);
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await stop(farm);
}

async function post(path, body) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`POST ${path} returned ${response.status}: ${await response.text()}`);
  return response.json();
}

async function waitForStatus(id, status) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const run = await (await fetch(`${origin}/api/agent/runs/${id}`)).json();
    if (run.status === status) return run;
    if (run.status === "failed") throw new Error(`The run failed: ${JSON.stringify(run.error)}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`The run did not reach ${status}.`);
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
    server.listen(0, "127.0.0.1", () => {
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
