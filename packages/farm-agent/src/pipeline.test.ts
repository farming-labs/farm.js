// The agent API is an ordinary Farm route: a request passes the app's middleware and plugin
// guards before it reaches the agents, in `farm dev` and in a built node server. agent-unit's own
// mounts (a Vite middleware ahead of Farm's, a Nitro handler beside Farm's catch-all) answered
// first, so an app guarding /api/** served every run to anonymous callers.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { build, loadConfig, resolveConfig } from "@farm.js/core";
import { createServer } from "@farm.js/core/server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreRoot = path.resolve(packageRoot, "../farm");
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

beforeAll(() => {
  // The app imports @farm.js/agent the way a user's does, from its build.
  if (!existsSync(path.join(packageRoot, "dist/index.js"))) {
    throw new Error("Build @farm.js/agent first: pnpm --filter @farm.js/agent build");
  }
});

// Guards an app might put on its API: config middleware, a plugin's runtime.before, and an
// integration's middleware (what protectedRoutes compiles to).
const config = (dataDir: string, agentOptions: string) => `import { agent } from "@farm.js/agent";
import { defineConfig, defineIntegration } from "@farm.js/core";
import { definePlugin } from "@farm.js/core/plugin";

export default defineConfig({
  images: { provider: "none" },
  telemetry: false,
  middleware: [
    {
      matcher: ["/api/:path*"],
      handler(ctx, next) {
        // A Node request in development, a Web Request in production.
        const headers = ctx.request.headers;
        const value = typeof headers.get === "function" ? headers.get("x-middleware") : headers["x-middleware"];
        if (value !== "ok") {
          return new Response("blocked by middleware", { status: 401 });
        }
        return next();
      },
    },
  ],
  plugins: [
    definePlugin({
      name: "test:guard",
      runtime: {
        before({ request }) {
          if (request.headers.get("x-plugin") !== "ok") {
            return new Response("blocked by runtime.before", { status: 401 });
          }
        },
      },
    }),
  ],
  integrations: {
    // An auth integration's protectedRoutes compile to integration middleware like this one. It
    // guards every agent route, POSTs too: the route still reads the body the guard read first.
    auth: defineIntegration({
      category: "auth",
      type: "test-auth",
      middleware: [
        {
          matcher: "/api/agent/:path*",
          handler(request) {
            if (request.headers.get("x-integration") !== "ok") {
              return new Response("blocked by integration", { status: 401 });
            }
          },
        },
      ],
    }),
    agent: agent({ ${agentOptions} }),
  },
});
`;

const FILES: Record<string, string> = {
  "src/agents/checkout.ts": `import { defineAgent } from "agent-unit";
export default defineAgent(async (input: { orderId: string }, run) => {
  const payment = await run.waitFor<{ amount: number }>("payment.succeeded", {
    match: { orderId: input.orderId }, timeout: "1h",
  });
  return payment.amount;
});`,
  "src/app/layout.tsx": `export default function Layout({ children }) { return <main>{children}</main>; }`,
  "src/app/page.tsx": `export default function Page() { return <h1>Home</h1>; }`,
  "src/agents/refund.ts": `import { defineAgent } from "agent-unit";
export default defineAgent(async (input: { orderId: string }, run) => {
  const order = await run.step("look up order", async () => ({ id: input.orderId }));
  const { approved } = await run.interrupt<{ approved: boolean }>("approve-refund", order);
  return approved ? \`refunded \${order.id}\` : \`kept \${order.id}\`;
});`,
};

async function createApp(
  prefix: string,
  agentOptions = "",
  { storage = true }: { storage?: boolean } = {},
): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  cleanups.push(() =>
    fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
  );
  const modules = path.join(root, "node_modules");
  await fs.mkdir(path.join(modules, "@farm.js"), { recursive: true });
  await fs.symlink(coreRoot, path.join(modules, "@farm.js/core"), "junction");
  await fs.symlink(packageRoot, path.join(modules, "@farm.js/agent"), "junction");
  const links: Array<[string, string]> = [
    ["agent-unit", path.join(packageRoot, "node_modules/agent-unit")],
    // agent-unit's generated server imports nitro/storage and nitro/task by name.
    ["nitro", path.join(coreRoot, "node_modules/nitro")],
    ["react", path.join(coreRoot, "node_modules/react")],
    ["react-dom", path.join(coreRoot, "node_modules/react-dom")],
  ];
  for (const [name, target] of links) {
    await fs.symlink(await fs.realpath(target), path.join(modules, name), "junction");
  }
  await fs.writeFile(
    path.join(root, "package.json"),
    '{"name":"agent-guard-app","version":"0.0.0","type":"module","private":true}',
  );
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    config(
      path.join(root, ".data"),
      [
        storage &&
          `storage: { driver: "fs-lite", base: ${JSON.stringify(path.join(root, ".data"))} }`,
        agentOptions,
      ]
        .filter(Boolean)
        .join(", "),
    ),
  );
  for (const [file, source] of Object.entries(FILES)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), source);
  }
  return root;
}

function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address ? resolve(address.port) : reject(new Error("port")),
      );
    });
  });
}

const PASS = { "x-middleware": "ok", "x-plugin": "ok", "x-integration": "ok" };
const JSON_BODY = { "content-type": "application/json" };

async function expectGuardedAgentAPI(origin: string) {
  const routes: Array<[string, string, RequestInit?]> = [
    ["list runs", "/api/agent/runs"],
    ["start", "/api/agent/agents/refund/runs", { method: "POST", body: '{"input":{}}' }],
    ["resume", "/api/agent/runs/run_aaaaaaaaaaaa/resume", { method: "POST", body: "{}" }],
    ["manifest", "/api/agent/manifest.json"],
    ["send event", "/api/agent/events", { method: "POST", body: '{"name":"payment.succeeded"}' }],
  ];
  // Each guard on its own: the others let the request through.
  for (const [guard, body] of [
    ["middleware", "blocked by middleware"],
    ["plugin", "blocked by runtime.before"],
    ["integration", "blocked by integration"],
  ] as const) {
    const headers: Record<string, string> = { ...PASS };
    delete headers[`x-${guard}`];
    for (const [name, pathname, init] of routes) {
      const response = await fetch(`${origin}${pathname}`, {
        ...init,
        headers: { ...JSON_BODY, ...headers },
      });
      expect(
        { route: name, guard, status: response.status, body: await response.text() },
        `${init?.method ?? "GET"} ${pathname}`,
      ).toEqual({ route: name, guard, status: 401, body });
    }
  }
}

// Statuses a run stays in until it is answered, woken or deleted.
const SETTLED = new Set(["interrupted", "sleeping", "waiting", "completed", "failed", "cancelled"]);

async function readRun(origin: string, id: string, status: string) {
  // The run settles in the background; read it until it reaches `status`. A run that settles
  // anywhere else will not get there, so report what it did (a failed run carries its error).
  let last: { status?: string; error?: { message?: string } } = {};
  for (let attempt = 0; attempt < 100; attempt++) {
    const run = await (await fetch(`${origin}/api/agent/runs/${id}`, { headers: PASS })).json();
    if (run.status === status) return run;
    last = run;
    if (SETTLED.has(run.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const error = last.error?.message ? `: ${last.error.message}` : "";
  throw new Error(`run ${id} is ${last.status ?? "unreadable"}, not ${status}${error}`);
}

async function expectRunsThroughGuards(origin: string) {
  const checkout = await fetch(`${origin}/api/agent/agents/checkout/runs`, {
    method: "POST",
    headers: { ...JSON_BODY, ...PASS },
    body: JSON.stringify({ input: { orderId: "P1" } }),
  });
  expect(checkout.status).toBe(202);
  const paymentRun = await checkout.json();
  expect((await readRun(origin, paymentRun.id, "waiting")).wait.event).toBe("payment.succeeded");
  const sendPayment = (orderId: string, id: string) =>
    fetch(`${origin}/api/agent/events`, {
      method: "POST",
      headers: { ...JSON_BODY, ...PASS },
      body: JSON.stringify({ name: "payment.succeeded", data: { orderId, amount: 42 }, id }),
    });
  expect((await (await sendPayment("other", "unmatched")).json()).runs).toEqual([]);
  expect((await readRun(origin, paymentRun.id, "waiting")).status).toBe("waiting");
  const paid = await sendPayment("P1", "payment-1");
  expect(paid.status).toBe(202);
  expect((await paid.json()).runs).toEqual([paymentRun.id]);
  expect((await readRun(origin, paymentRun.id, "completed")).output).toBe(42);
  expect(await (await sendPayment("P1", "payment-1")).json()).toMatchObject({
    duplicate: true,
    runs: [],
  });

  const started = await fetch(`${origin}/api/agent/agents/refund/runs`, {
    method: "POST",
    headers: { ...JSON_BODY, ...PASS },
    body: JSON.stringify({ input: { orderId: "A1" } }),
  });
  expect(started.status).toBe(202);
  const { id } = await started.json();
  const interrupted = await readRun(origin, id, "interrupted");
  expect(interrupted.input, "input stored before resume").toEqual({ orderId: "A1" });
  expect(interrupted.interrupt?.name).toBe("approve-refund");

  const listed = await (
    await fetch(`${origin}/api/agent/runs?status=interrupted`, { headers: PASS })
  ).json();
  expect(listed.runs.map((run: { id: string }) => run.id)).toContain(id);

  const resumed = await fetch(`${origin}/api/agent/runs/${id}/resume`, {
    method: "POST",
    headers: { ...JSON_BODY, ...PASS },
    body: JSON.stringify({ answer: { approved: true } }),
  });
  expect(resumed.status).toBe(202);
  expect((await readRun(origin, id, "completed")).output).toBe("refunded A1");

  // A streamed start sends the run's events as they happen.
  const streamed = await fetch(`${origin}/api/agent/agents/refund/runs`, {
    method: "POST",
    headers: { ...JSON_BODY, ...PASS, accept: "text/event-stream" },
    body: JSON.stringify({ input: { orderId: "S1" } }),
  });
  expect(streamed.headers.get("content-type")).toMatch(/^text\/event-stream/);
  const reader = streamed.body!.getReader();
  const decoder = new TextDecoder();
  let events = "";
  while (!events.includes('"RUN_INTERRUPTED"')) {
    const { value, done } = await reader.read();
    if (done) break;
    events += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  expect(events).toContain('"RUN_STARTED"');
  expect(events).toContain('"RUN_INTERRUPTED"');
}

describe("the agent API runs through Farm's request pipeline", () => {
  it("in development", async () => {
    const root = await createApp("farm-agent-dev-");
    const server = await createServer({ root });
    cleanups.push(() => server.close());
    await server.listen(await availablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;

    await expectGuardedAgentAPI(origin);
    await expectRunsThroughGuards(origin);
  }, 120_000);

  it("in a production node server", async ({ onTestFailed }) => {
    const root = await createApp("farm-agent-prod-");
    const resolved = await resolveConfig(
      {
        ...(await loadConfig(root, undefined, "production")),
        root,
        srcDir: "src",
        deploy: { target: "node" },
      },
      "production",
    );
    await build(resolved, { root, preset: "node-server" });

    const port = await availablePort();
    const child: ChildProcess = spawn(
      process.execPath,
      [path.resolve(root, resolved.deploy.outputDir, "server/index.mjs")],
      { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: "pipe" },
    );
    let output = "";
    // The engine reports a run it could not execute on the server's stderr.
    onTestFailed(() => console.error(`The production server's output:\n${output}`));
    const listening = new Promise<void>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        output += chunk;
        if (output.includes("Listening on")) resolve();
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.once("exit", () => reject(new Error(`The server exited\n${output}`)));
    });
    cleanups.push(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await exited;
    });
    await listening;
    const origin = `http://localhost:${port}`;

    await expectGuardedAgentAPI(origin);
    await expectRunsThroughGuards(origin);
  }, 240_000);
});

async function buildForVercel(root: string): Promise<void> {
  const resolved = await resolveConfig(
    {
      ...(await loadConfig(root, undefined, "production")),
      root,
      srcDir: "src",
      deploy: { target: "vercel" },
    },
    "production",
  );
  await build(resolved, { root, preset: "vercel" });
}

/** The built Vercel function's entry, as a file URL to import. */
async function vercelEntry(root: string): Promise<string> {
  const functions = path.join(root, ".vercel/output/functions");
  const functionDir = (await fs.readdir(functions)).find((name) =>
    existsSync(path.join(functions, name, "index.mjs")),
  );
  if (!functionDir) throw new Error("The Vercel build has no server function");
  return pathToFileURL(path.join(functions, functionDir, "index.mjs")).href;
}

/** Runs `script` as an ES module in a production process of its own; resolves with its output. */
function runScript(root: string, script: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      cwd: root,
      env,
      stdio: "pipe",
    });
    let out = "";
    child.stdout?.on("data", (chunk) => (out += chunk));
    child.stderr?.on("data", (chunk) => (out += chunk));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`exit ${code}\n${out}`)),
    );
  });
}

// Vercel Cron calls the Nitro route that runs agent-unit's sweep and the app's tasks over public
// HTTP. Nitro checks CRON_SECRET there only when it is set, so the route ran them for anyone.
describe("the agent's Vercel cron route", () => {
  it("runs the scheduled tasks only for a caller with CRON_SECRET", async () => {
    const root = await createApp(
      "farm-agent-vercel-",
      `tasks: { ping: { schedule: "* * * * *", handler: "src/tasks/ping.ts" } }`,
    );
    const marker = path.join(root, "ping-ran");
    await fs.mkdir(path.join(root, "src/tasks"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src/tasks/ping.ts"),
      `import { writeFileSync } from "node:fs";
export default async () => { writeFileSync(${JSON.stringify(marker)}, "ran"); };`,
    );
    await buildForVercel(root);

    const output = path.join(root, ".vercel/output");
    const vercelConfig = JSON.parse(await fs.readFile(path.join(output, "config.json"), "utf8"));
    expect(vercelConfig.crons).toContainEqual({ path: "/_vercel/cron", schedule: "* * * * *" });

    // The built function as Vercel invokes it, in a production process of its own.
    const entry = await vercelEntry(root);
    const script = `
import { existsSync, rmSync } from "node:fs";
const { default: server } = await import(${JSON.stringify(entry)});
const cases = [
  ["no secret configured", undefined, {}],
  ["no bearer", "cron-secret", {}],
  ["wrong bearer", "cron-secret", { authorization: "Bearer nope" }],
  ["bearer", "cron-secret", { authorization: "Bearer cron-secret" }],
];
const results = [];
for (const [name, secret, headers] of cases) {
  if (secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = secret;
  rmSync(${JSON.stringify(marker)}, { force: true });
  const pending = [];
  const response = await server.fetch(
    new Request("https://app.example/_vercel/cron", {
      headers: { "x-vercel-cron-schedule": "* * * * *", ...headers },
    }),
    { waitUntil: (promise) => pending.push(promise) },
  );
  await Promise.allSettled(pending);
  results.push({ name, status: response.status, ran: existsSync(${JSON.stringify(marker)}) });
}
console.log("RESULTS " + JSON.stringify(results));
`;
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
    delete env.CRON_SECRET;
    const stdout = await runScript(root, script, env);
    const line = stdout.split("\n").find((value) => value.startsWith("RESULTS "));
    if (!line) throw new Error(`No results\n${stdout}`);
    expect(JSON.parse(line.slice("RESULTS ".length))).toEqual([
      { name: "no secret configured", status: 401, ran: false },
      { name: "no bearer", status: 401, ran: false },
      { name: "wrong bearer", status: 401, ran: false },
      { name: "bearer", status: 200, ran: true },
    ]);
  }, 240_000);
});

// A task can run one of the app's agents (agent-unit 0.5): the cron route starts it, once per
// scheduled time however often the scheduler fires. Farm.js Infra can then cancel the run from its
// approval, with a call signed for the very path Farm serves the agent API under.
describe("an agent task on Vercel", () => {
  it("starts one run per scheduled time, and Infra's signed cancel reaches it", async () => {
    const root = await createApp(
      "farm-agent-task-",
      `tasks: { "nightly-refund": { schedule: "0 0 * * *", agent: "refund", input: { orderId: "T1" } } }`,
    );
    await buildForVercel(root);

    const script = `
import { createHash, createHmac } from "node:crypto";
const { default: server } = await import(${JSON.stringify(await vercelEntry(root))});
const PASS = ${JSON.stringify(PASS)};
const call = async (pathname, init = {}) => {
  const pending = [];
  const response = await server.fetch(new Request("https://app.example" + pathname, init), {
    waitUntil: (promise) => pending.push(promise),
  });
  const failed = (await Promise.allSettled(pending)).filter((result) => result.status === "rejected");
  if (failed.length) throw failed[0].reason;
  return response;
};
const fire = async () =>
  (await call("/_vercel/cron", {
    headers: { "x-vercel-cron-schedule": "0 0 * * *", authorization: "Bearer cron-secret" },
  })).status;

// The scheduler fires twice for one scheduled time, as a retried cron call does.
const fires = [await fire(), await fire()];
const { runs } = await (await call("/api/agent/runs", { headers: PASS })).json();
const run = runs.length === 1 ? await (await call("/api/agent/runs/" + runs[0].id, { headers: PASS })).json() : undefined;

// Infra signs the method and the path it calls with the hex SHA-256 of FARMJS_API_KEY.
process.env.FARMJS_API_KEY = "farmjs_test_vector_key";
const pathname = "/api/agent/__agent-unit/cancel/" + run?.id;
const body = JSON.stringify({ key: run?.interrupt?.key, interrupt: run?.interrupt?.name });
const hmacKey = createHash("sha256").update(process.env.FARMJS_API_KEY).digest("hex");
const t = String(Math.floor(Date.now() / 1000));
const v1 = createHmac("sha256", hmacKey).update("farmjs-agent-v1\\n" + t + "\\nPOST " + pathname).digest("hex");
const headers = { ...PASS, "content-type": "application/json" };
const unsigned = await call(pathname, { method: "POST", headers, body });
const signed = await call(pathname, {
  method: "POST",
  headers: { ...headers, "farmjs-signature": "t=" + t + ",v1=" + v1 },
  body,
});
const after = await (await call("/api/agent/runs/" + run?.id, { headers: PASS })).json();
console.log("RESULTS " + JSON.stringify({
  fires,
  runs: runs.length,
  id: run?.id,
  status: run?.status,
  input: run?.input,
  interrupt: run?.interrupt?.name,
  unsigned: unsigned.status,
  signed: [signed.status, await signed.json()],
  after: after.status,
}));
`;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      CRON_SECRET: "cron-secret",
    };
    delete env.FARMJS_API_KEY;
    const stdout = await runScript(root, script, env);
    const line = stdout.split("\n").find((value) => value.startsWith("RESULTS "));
    if (!line) throw new Error(`No results\n${stdout}`);
    const results = JSON.parse(line.slice("RESULTS ".length));
    // A run started by a task has an id derived from the task and its scheduled time.
    expect(results.id).toMatch(/^run_[0-9a-f]{32}$/);
    expect({ ...results, id: undefined }).toEqual({
      fires: [200, 200],
      runs: 1,
      status: "interrupted",
      input: { orderId: "T1" },
      interrupt: "approve-refund",
      unsigned: 401,
      signed: [200, { status: "cancelled" }],
      after: "cancelled",
    });
  }, 240_000);
});

// Without `storage`, agent-unit keeps runs in Farm.js storage when the build has FARMJS_API_KEY,
// and stops a build for a host without a durable disk that has neither, rather than keeping runs
// in memory, where a serverless function loses them between requests.
describe("the agent's run storage on a serverless target", () => {
  /** Sets FARMJS_API_KEY for this test's build, and puts back what the process had after it. */
  function buildKey(value: string | undefined) {
    const previous = process.env.FARMJS_API_KEY;
    if (value === undefined) delete process.env.FARMJS_API_KEY;
    else process.env.FARMJS_API_KEY = value;
    cleanups.push(async () => {
      if (previous === undefined) delete process.env.FARMJS_API_KEY;
      else process.env.FARMJS_API_KEY = previous;
    });
  }

  it("stops the build, saying what to set, without storage or FARMJS_API_KEY", async () => {
    const root = await createApp("farm-agent-no-storage-", "", { storage: false });
    buildKey(undefined);
    await expect(buildForVercel(root)).rejects.toThrow(
      /runs on vercel need storage that outlives a request[\s\S]*add FARMJS_API_KEY/,
    );
  }, 240_000);

  it("keeps runs in Farm.js storage when the build has FARMJS_API_KEY", async () => {
    const root = await createApp("farm-agent-farmjs-storage-", "", { storage: false });
    buildKey("fk_build_only_not_a_real_key");
    await buildForVercel(root);

    // Run where the key is missing, a run request fails and names it: proof the function keeps
    // runs in Farm.js storage, with no call to Farm.js.
    const script = `
const { default: server } = await import(${JSON.stringify(await vercelEntry(root))});
const response = await server.fetch(
  new Request("https://app.example/api/agent/runs", { headers: ${JSON.stringify(PASS)} }),
  { waitUntil() {} },
);
console.log("STATUS " + response.status);
`;
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
    delete env.FARMJS_API_KEY;
    const output = await runScript(root, script, env);
    expect(output).toContain("STATUS 500");
    expect(output).toContain(
      "runs are kept in Farm.js storage here, but FARMJS_API_KEY is not set",
    );
  }, 240_000);
});
