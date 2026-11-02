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
import { fileURLToPath } from "node:url";
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
const config = (dataDir: string) => `import { agent } from "@farm.js/agent";
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
    agent: agent({ storage: { driver: "fs-lite", base: ${JSON.stringify(dataDir)} } }),
  },
});
`;

const FILES: Record<string, string> = {
  "src/app/layout.tsx": `export default function Layout({ children }) { return <main>{children}</main>; }`,
  "src/app/page.tsx": `export default function Page() { return <h1>Home</h1>; }`,
  "src/agents/refund.ts": `import { defineAgent } from "agent-unit";
export default defineAgent(async (input: { orderId: string }, run) => {
  const order = await run.step("look up order", async () => ({ id: input.orderId }));
  const { approved } = await run.interrupt<{ approved: boolean }>("approve-refund", order);
  return approved ? \`refunded \${order.id}\` : \`kept \${order.id}\`;
});`,
};

async function createApp(prefix: string): Promise<string> {
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
  await fs.writeFile(path.join(root, "farm.config.ts"), config(path.join(root, ".data")));
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

async function readRun(origin: string, id: string, status: string) {
  // The run settles in the background; read it until it reaches `status`.
  for (let attempt = 0; attempt < 100; attempt++) {
    const run = await (await fetch(`${origin}/api/agent/runs/${id}`, { headers: PASS })).json();
    if (run.status === status) return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`run ${id} never reached ${status}`);
}

async function expectRunsThroughGuards(origin: string) {
  const started = await fetch(`${origin}/api/agent/agents/refund/runs`, {
    method: "POST",
    headers: { ...JSON_BODY, ...PASS },
    body: JSON.stringify({ input: { orderId: "A1" } }),
  });
  expect(started.status).toBe(202);
  const { id } = await started.json();
  expect((await readRun(origin, id, "interrupted")).interrupt?.name).toBe("approve-refund");

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

  it("in a production node server", async () => {
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
