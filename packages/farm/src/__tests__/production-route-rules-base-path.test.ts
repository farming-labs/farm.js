// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { nitroRouteRulesBelowBasePath } from "../route-rules";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("Nitro route rules below a basePath", () => {
  it("also keys each rule by its public path, with app-relative redirect targets moved", () => {
    const rules = nitroRouteRulesBelowBasePath(
      {
        "/about": { swr: 60 },
        "/blog/**": { cache: { maxAge: 10 } },
        "/old": { redirect: { to: "/about", status: 307 } },
        "/away": { redirect: { to: "https://example.com/", status: 307 } },
        "/api/hello": { cors: true },
        "/api/**": { swr: 5 },
      },
      "/console",
      "/api",
    );

    expect(rules).toEqual({
      "/about": { swr: 60 },
      "/console/about": { swr: 60 },
      "/blog/**": { cache: { maxAge: 10 } },
      "/console/blog/**": { cache: { maxAge: 10 } },
      "/old": { redirect: { to: "/about", status: 307 } },
      "/console/old": { redirect: { to: "/console/about", status: 307 } },
      "/away": { redirect: { to: "https://example.com/", status: 307 } },
      "/console/away": { redirect: { to: "https://example.com/", status: 307 } },
      // Local API routes are served at the API path, not below the basePath.
      "/api/hello": { cors: true },
      "/api/**": { swr: 5 },
    });
  });

  it("keeps a rule the app wrote for the public path, and changes nothing without a basePath", () => {
    const written = { "/about": { swr: 60 }, "/console/about": { swr: false } };
    expect(nitroRouteRulesBelowBasePath(written, "/console", "/api")["/console/about"]).toEqual({
      swr: false,
    });
    expect(nitroRouteRulesBelowBasePath({ "/about": { swr: 60 } }, "/", "/api")).toEqual({
      "/about": { swr: 60 },
    });
  });

  it("applies a swr rule at the URL visitors request from a Node server", async () => {
    // Inside the package so the pages resolve React through the workspace.
    const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-route-rules-base-path-"));
    temporaryRoots.push(root);
    const write = async (relativePath: string, source: string) => {
      const filePath = path.join(root, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, source);
    };
    await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
    await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
    await write("package.json", '{"private":true,"type":"module"}');
    await write(
      "src/app/layout.tsx",
      "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
    );
    await write(
      "src/app/about/page.tsx",
      `export const dynamic = "force-dynamic";
export default function About() { return <main data-rendered-at={String(Date.now() + Math.random())}>about-page</main>; }`,
    );

    const config = await resolveConfig(
      {
        root,
        srcDir: "src",
        basePath: "/console",
        images: { provider: "none" },
        telemetry: false,
        deploy: { target: "node-server" },
        routeRules: {
          "/about": { swr: 60 },
          "/old": { redirect: "/about" },
        },
      },
      "production",
    );
    await build(config, { root, preset: config.deploy.preset });

    const outputDir = path.join(root, ".farm", ".output");
    const port = await getAvailablePort();
    const server = spawn(process.execPath, [path.join(outputDir, "server", "index.mjs")], {
      cwd: path.join(outputDir, "server"),
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
      stdio: "ignore",
    });
    const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
    try {
      const request = async (pathname: string): Promise<Response> => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await fetch(`http://127.0.0.1:${port}${pathname}`, { redirect: "manual" });
          } catch (error) {
            if (attempt >= 100 || server.exitCode !== null) throw error;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
      };
      // The page below the basePath goes through the same swr rule as the app path: Nitro's
      // cache handler answers it (x-cache) with the rule's cache-control, where it used to fall
      // through to an uncached render.
      for (const pathname of ["/about", "/console/about"]) {
        const response = await request(pathname);
        expect(response.status, pathname).toBe(200);
        expect(response.headers.get("cache-control"), pathname).toBe(
          "public, max-age=60, s-maxage=60",
        );
        expect(response.headers.get("x-cache"), pathname).not.toBeNull();
        expect(await response.text(), pathname).toContain("about-page");
      }

      const redirect = await request("/console/old");
      expect(redirect.status).toBe(307);
      expect(redirect.headers.get("location")).toBe("/console/about");
    } finally {
      // Windows refuses to remove the output while the server still holds it as its cwd.
      if (server.exitCode === null) {
        server.kill("SIGTERM");
        await exited;
      }
    }
  }, 180_000);
});
