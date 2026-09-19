// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { createServer } from "../server/create-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close().catch(() => {})));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) => fs.rm(root, { recursive: true, force: true })),
  );
  temporaryRoots.clear();
});

async function createProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-dev-openapi-mw-"));
  temporaryRoots.add(root);

  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  for (const dependency of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", dependency)),
      path.join(root, "node_modules", dependency),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `export default {
  openapi: { enabled: true, title: "Guarded API" },
  middleware: [
    {
      matcher: ["/openapi.json", "/docs/api"],
      handler() {
        return new Response("sign-in required", {
          status: 401,
          headers: { "x-openapi-guard": "yes" },
        });
      },
    },
  ],
};`,
  );
  await fs.mkdir(path.join(root, "src", "app", "api", "secret-admin-endpoint"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `import React from "react";
export default function Layout({ children }) {
  return <>{children}</>;
}`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "api", "secret-admin-endpoint", "route.ts"),
    `export function GET() {
  return Response.json({ ok: true });
}`,
  );

  return root;
}

async function listen(root: string) {
  const server = await createServer({ root, images: { provider: "none" } });
  servers.add(server);
  await server.listen(0);
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return `http://localhost:${address.port}`;
}

describe("development OpenAPI middleware ordering", () => {
  it("runs app middleware before serving the generated spec", async () => {
    const origin = await listen(await createProject());

    const response = await fetch(`${origin}/openapi.json`);
    const body = await response.text();

    // The guard must fire before the spec is produced, matching production,
    // where the spec route runs after the middleware runner.
    expect(response.status).toBe(401);
    expect(response.headers.get("x-openapi-guard")).toBe("yes");
    expect(body).not.toContain("secret-admin-endpoint");
  }, 60_000);

  it("runs app middleware before a non-GET reaches the spec route", async () => {
    const origin = await listen(await createProject());

    // Production middleware sees the method first; the dev 405 must not
    // leak the route's existence past a guard either.
    const response = await fetch(`${origin}/openapi.json`, { method: "POST" });
    expect(response.status).toBe(401);
    expect(response.headers.get("x-openapi-guard")).toBe("yes");
  }, 60_000);

  it("serves the spec normally on paths middleware does not guard", async () => {
    const root = await createProject();
    // Same project, guard matcher removed.
    await fs.writeFile(
      path.join(root, "farm.config.ts"),
      `export default { openapi: { enabled: true, title: "Guarded API" } };`,
    );
    const origin = await listen(root);

    const response = await fetch(`${origin}/openapi.json`);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("secret-admin-endpoint");
  }, 60_000);
});
