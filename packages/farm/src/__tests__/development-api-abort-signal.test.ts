// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViteDevServer } from "vite";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

async function writeModule(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

declare global {
  // Set by the route below; the route runs in this process under Vite SSR.
  var __farmAbortProbe: { started: boolean; aborted: boolean } | undefined;
}

async function startApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-api-abort-"));
  temporaryRoots.add(root);

  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  for (const pkg of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
      path.join(root, "node_modules", pkg),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await writeModule(
    root,
    "src/app/layout.tsx",
    `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }`,
  );
  await writeModule(
    root,
    "src/app/page.tsx",
    `import React from "react";
export default function Page() { return <main>home</main>; }`,
  );
  // A streaming route that, like an AI chat, should stop work when the client leaves.
  await writeModule(
    root,
    "src/app/api/stream/route.ts",
    `export async function GET(request: Request) {
  const probe = (globalThis.__farmAbortProbe = { started: true, aborted: false });
  request.signal.addEventListener("abort", () => {
    probe.aborted = true;
  });
  let timer;
  const body = new ReadableStream({
    start(controller) {
      timer = setInterval(() => controller.enqueue(new TextEncoder().encode("data: tick\\n\\n")), 20);
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}`,
  );

  await writeModule(
    root,
    "src/app/api/done/route.ts",
    `export async function POST(request: Request) {
  const probe = (globalThis.__farmAbortProbe = { started: true, aborted: false });
  request.signal.addEventListener("abort", () => {
    probe.aborted = true;
  });
  return new Response(await request.text());
}`,
  );

  const server = await createServer({ root, images: { provider: "none" } });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");

  return `http://localhost:${address.port}`;
}

describe("development API route abort signal", () => {
  it("aborts request.signal when the client disconnects mid-stream", async () => {
    const origin = await startApp();
    globalThis.__farmAbortProbe = undefined;
    const client = new AbortController();
    const response = await fetch(`${origin}/api/stream`, {
      signal: client.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    await reader.read();
    expect(globalThis.__farmAbortProbe?.started).toBe(true);
    expect(globalThis.__farmAbortProbe?.aborted).toBe(false);

    client.abort();
    await reader.cancel().catch(() => undefined);

    await vi.waitFor(() => expect(globalThis.__farmAbortProbe?.aborted).toBe(true), {
      timeout: 5_000,
    });
  }, 60_000);

  it("leaves request.signal alone when the response completes", async () => {
    const origin = await startApp();
    globalThis.__farmAbortProbe = undefined;
    const response = await fetch(`${origin}/api/done`, { method: "POST", body: "hello" });
    expect(await response.text()).toBe("hello");
    // Give a late close event the chance to fire before checking.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(globalThis.__farmAbortProbe?.started).toBe(true);
    expect(globalThis.__farmAbortProbe?.aborted).toBe(false);
  }, 60_000);
});
