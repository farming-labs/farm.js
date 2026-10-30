// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { getAvailablePort } from "./dev-server-port";

// An integration guard on an exact path (`protectedRoutes: ["/admin"]`
// compiles to the matcher ["/admin"]) has to cover every way a built app
// serves that page: the HTML, the `.md` mirror, and the same URL negotiated
// to Markdown with `Accept: text/markdown`.

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const FARM_CONFIG = `
import { defineConfig, defineIntegration } from "@farm.js/core";

const guard = defineIntegration({
  category: "auth",
  type: "exact-path-guard",
  middleware: [
    {
      matcher: ["/admin"],
      handler(request) {
        if (request.headers.get("cookie")?.includes("session=ok")) return;
        return new Response("GUARD-BLOCKED", { status: 401 });
      },
    },
  ],
});

export default defineConfig({
  telemetry: false,
  images: { provider: "none" },
  md: { enabled: true },
  integrations: { guard },
});
`;

async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-integration-guard-md-"));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.mkdir(path.join(root, "src", "app", "admin"), { recursive: true });
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
    path.join(root, "src", "app", "admin", "page.tsx"),
    "export default function Page() { return <main>ADMIN-SECRET</main>; }",
  );
  return root;
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

describe("exact-path integration guards", () => {
  it("cover the markdown mirror and markdown negotiation in production", async () => {
    const root = await createFixture();
    try {
      const userConfig = await loadConfig(root, undefined, "production");
      const config = await resolveConfig({ ...userConfig, root }, "production");
      await build(config, { root, preset: "node-server" });
      await withProductionServer(path.join(root, ".farm", ".output", "server"), async (baseUrl) => {
        const requests = [
          { pathname: "/admin", accept: "text/html", type: "text/html" },
          { pathname: "/admin.md", accept: "*/*", type: "text/markdown" },
          { pathname: "/admin", accept: "text/markdown", type: "text/markdown" },
        ];
        for (const { pathname, accept, type } of requests) {
          const get = (cookie?: string) =>
            fetch(new URL(pathname, baseUrl), {
              headers: { accept, ...(cookie ? { cookie } : {}) },
              redirect: "manual",
            });

          const anonymous = await get();
          const anonymousBody = await anonymous.text();
          expect({ pathname, accept, status: anonymous.status }).toEqual({
            pathname,
            accept,
            status: 401,
          });
          expect(anonymousBody).not.toContain("ADMIN-SECRET");

          const signedIn = await get("session=ok");
          expect({ pathname, accept, status: signedIn.status }).toEqual({
            pathname,
            accept,
            status: 200,
          });
          expect(signedIn.headers.get("content-type")).toContain(type);
          expect(await signedIn.text()).toContain("ADMIN-SECRET");
        }
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }, 180_000);
});
