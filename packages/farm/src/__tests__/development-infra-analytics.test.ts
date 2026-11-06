// @vitest-environment node

import fs from "node:fs/promises";
import { createServer as createNodeServer, type IncomingHttpHeaders } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViteDevServer } from "vite";
import { createServer } from "../server/create-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();
const INFRA_VARIABLES = ["FARMJS_API_KEY", "FARMJS_API_URL", "FARMJS_PROJECT_ID"];

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
  // loadConfig copies .env values into process.env.
  for (const name of INFRA_VARIABLES) delete process.env[name];
});

async function listen(server: ReturnType<typeof createNodeServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  return address.port;
}

async function createFixture(env: string, config?: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-infra-analytics-"));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await fs.writeFile(path.join(root, ".env"), env);
  if (config) await fs.writeFile(path.join(root, "farm.config.ts"), config);
  await fs.mkdir(path.join(root, "src", "app", "users", "[id]"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "users", "[id]", "page.tsx"),
    `import React from "react";
export default function User({ params }) { return <main>user {params.id}</main>; }`,
  );
  return root;
}

async function request(root: string, pathname: string): Promise<Response> {
  const server = await createServer({ root, images: { provider: "none" } });
  servers.add(server);
  await server.listen(0);
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return fetch(`http://localhost:${address.port}${pathname}`);
}

describe("built-in Farm Infra analytics in development", () => {
  const received: { headers: IncomingHttpHeaders; body: string }[] = [];
  const receiver = createNodeServer((incoming, response) => {
    let body = "";
    incoming.on("data", (chunk) => (body += chunk));
    incoming.on("end", () => {
      received.push({ headers: incoming.headers, body });
      response.writeHead(202).end();
    });
  });
  afterEach(() => {
    received.length = 0;
    receiver.close();
  });

  it("reports development requests for an app whose .env links a project, with no config", async () => {
    const port = await listen(receiver);
    const key = `farmjs_${"d".repeat(32)}`;
    const projectId = "proj_0b8e2c7a-4c2e-4f7e-9a51-3d2f1c0b9e8d";
    const root = await createFixture(
      `FARMJS_API_KEY=${key}\nFARMJS_PROJECT_ID=${projectId}\nFARMJS_API_URL=http://127.0.0.1:${port}\n`,
    );

    const response = await request(root, "/users/private-customer?secret=private-query");
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("private-customer");

    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 5_000 });
    expect(received[0]!.headers).toMatchObject({
      authorization: `Bearer ${key}`,
      "x-farm-project": projectId,
      "x-farm-environment": "development",
    });
    expect(received[0]!.body).not.toContain("private");
    expect(JSON.parse(received[0]!.body).events).toEqual([
      expect.objectContaining({
        kind: "request",
        route: "/users/[id]",
        method: "GET",
        status: 200,
      }),
    ]);
  }, 30_000);

  it("reports built-in endpoints and Markdown mirrors by a route template", async () => {
    const port = await listen(receiver);
    const root = await createFixture(
      `FARMJS_API_KEY=fti_${"l".repeat(43)}\nFARMJS_API_URL=http://127.0.0.1:${port}\n`,
    );
    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);
    await server.listen(0);
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const status = async (pathname: string, init?: RequestInit) => {
      const response = await fetch(`http://localhost:${address.port}${pathname}`, init);
      await response.arrayBuffer();
      return response.status;
    };

    expect(
      await status("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    ).toBe(200);
    expect(await status("/llms.txt")).toBe(200);
    expect(await status("/users/private-customer.md")).toBe(200);
    expect(await status("/.well-known/farmjs.json")).toBe(200);
    expect(await status("/private-missing")).toBe(404);
    // Closing the server flushes every queued event.
    await Promise.all([...servers].map((value) => value.close()));
    servers.clear();

    const requests = received
      .flatMap(({ body }) => JSON.parse(body).events)
      .filter(({ kind }) => kind === "request")
      .map(({ method, route, status }) => `${method} ${route} ${status}`);
    expect(requests).toEqual(
      expect.arrayContaining([
        "POST /mcp 200",
        "GET /llms.txt 200",
        "GET /users/[id].md 200",
        "GET /.well-known/farmjs.json 200",
        "GET /[unmatched] 404",
      ]),
    );
    expect(requests.filter((line) => line.includes("/[unmatched]"))).toEqual([
      "GET /[unmatched] 404",
    ]);
    expect(received.map(({ body }) => body).join("")).not.toContain("private");
  }, 30_000);

  it("sends nothing when the config sets analytics to false", async () => {
    const port = await listen(receiver);
    const root = await createFixture(
      `FARMJS_API_KEY=fti_${"d".repeat(43)}\nFARMJS_API_URL=http://127.0.0.1:${port}\n`,
      "export default { analytics: false };",
    );

    const response = await request(root, "/users/someone");
    expect(response.status).toBe(200);
    await response.text();
    // Closing the server runs plugin shutdown, which is where a queued batch would flush.
    await Promise.all([...servers].map((server) => server.close()));
    servers.clear();
    expect(received).toEqual([]);
  }, 30_000);
});
