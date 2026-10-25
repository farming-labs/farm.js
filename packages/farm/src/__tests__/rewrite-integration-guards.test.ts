// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startDevServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

// An integration guard (`protectedRoutes`) has to cover a page however the
// request reaches it. Production dispatched integrations once, on the incoming
// URL, before app middleware ran, so a config middleware that called
// `ctx.rewrite("/dashboard")` for `/app` served the guarded page anonymously,
// while dev (which runs integrations after app middleware) refused it.

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const FARM_CONFIG = `
import { defineConfig, defineIntegration } from "@farm.js/core";
import { forwardIntegrationSetCookies } from "@farm.js/core/integrations";

const signedIn = (request) => request.headers.get("cookie")?.includes("session=ok");

// The dashboard's own guard: matches only the rewrite target.
const dashboardGuard = defineIntegration({
  category: "auth",
  type: "dashboard-guard",
  middleware: [
    {
      matcher: ["/dashboard(.*)"],
      handler(request, ctx) {
        if (!signedIn(request)) return new Response("GUARD-BLOCKED", { status: 401 });
        forwardIntegrationSetCookies(ctx, ["dashboard-guard=ran; Path=/"]);
      },
    },
  ],
});

// Matches the incoming URL and the target, so it must run once, not twice.
const sessionRefresh = defineIntegration({
  category: "custom",
  type: "session-refresh",
  middleware: [
    {
      matcher: ["/app(.*)", "/dashboard(.*)"],
      handler(request, ctx) {
        forwardIntegrationSetCookies(ctx, ["session-refresh=" + new URL(request.url).pathname + "; Path=/"]);
      },
    },
  ],
});

export default defineConfig({
  telemetry: false,
  images: { provider: "none" },
  vite: { server: { host: "127.0.0.1", strictPort: false } },
  integrations: { sessionRefresh, dashboardGuard },
  middleware: [
    {
      matcher: "/app/:path*",
      handler(ctx) {
        ctx.rewrite("/dashboard" + (ctx.params.path ? "/" + ctx.params.path : ""));
      },
    },
  ],
});
`;

async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-rewrite-integration-guards-"));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  // One React for the dev renderer and the page modules it loads.
  for (const dependency of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", dependency)),
      path.join(root, "node_modules", dependency),
      "junction",
    );
  }
  await fs.mkdir(path.join(root, "src", "app", "dashboard"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await fs.writeFile(path.join(root, "farm.config.ts"), FARM_CONFIG);
  await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    "export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }",
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    "export default function Page() { return <main>home</main>; }",
  );
  await fs.writeFile(
    path.join(root, "src", "app", "dashboard", "page.tsx"),
    "export default function Page() { return <main>DASHBOARD-SECRET</main>; }",
  );
  return root;
}

/** The same requests against development and production. */
async function expectGuardedRewrites(baseUrl: string): Promise<void> {
  const get = async (pathname: string, cookie?: string) => {
    const response = await fetch(new URL(pathname, baseUrl), {
      headers: cookie ? { cookie } : {},
      redirect: "manual",
    });
    return { status: response.status, body: await response.text(), response };
  };

  for (const pathname of ["/dashboard", "/app", "/app/settings"]) {
    const anonymous = await get(pathname);
    expect({ pathname, status: anonymous.status }).toEqual({ pathname, status: 401 });
    expect(anonymous.body).not.toContain("DASHBOARD-SECRET");
  }

  const signedIn = await get("/app", "session=ok");
  expect(signedIn.status).toBe(200);
  expect(signedIn.body).toContain("DASHBOARD-SECRET");
  const cookies = signedIn.response.headers.getSetCookie();
  expect(cookies.filter((cookie) => cookie.startsWith("dashboard-guard="))).toHaveLength(1);
  // Matches both URLs but runs once (production on the incoming URL, dev on the target).
  expect(cookies.filter((cookie) => cookie.startsWith("session-refresh="))).toHaveLength(1);
}

async function withProductionServer(
  serverDir: string,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const port = await getAvailablePort();
  const output: string[] = [];
  const server = spawn(process.execPath, [path.join(serverDir, "index.mjs")], {
    cwd: serverDir,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => output.push(String(chunk)));
  server.stderr.on("data", (chunk) => output.push(String(chunk)));
  const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    for (let attempt = 0; ; attempt++) {
      if (server.exitCode !== null) throw new Error(`Server exited:\n${output.join("")}`);
      try {
        await fetch(baseUrl);
        break;
      } catch {
        if (attempt > 200) throw new Error(`Server never answered:\n${output.join("")}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    await run(baseUrl);
  } finally {
    if (server.exitCode === null) {
      server.kill("SIGTERM");
      await exited;
    }
  }
}

describe("ctx.rewrite() targets keep their integration guards", () => {
  // Development first: a production build in this worker leaves a second React behind.
  it("guards the rewritten page in development", async () => {
    const root = await createFixture();
    try {
      const dev = await startDevServer({ root }, await getAvailablePort());
      try {
        const address = dev.httpServer!.address();
        if (!address || typeof address === "string") throw new Error("Dev server has no port");
        await expectGuardedRewrites(`http://127.0.0.1:${address.port}`);
      } finally {
        await dev.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }, 120_000);

  it("guards the rewritten page in production the same way", async () => {
    const root = await createFixture();
    try {
      const userConfig = await loadConfig(root, undefined, "production");
      const config = await resolveConfig({ ...userConfig, root }, "production");
      await build(config, { root, preset: "node-server" });
      await withProductionServer(path.join(root, ".farm", ".output", "server"), (baseUrl) =>
        expectGuardedRewrites(baseUrl),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }, 180_000);
});
