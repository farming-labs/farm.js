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
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) => fs.rm(root, { recursive: true, force: true })),
  );
  temporaryRoots.clear();
});

async function writeModule(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

describe("development runtime response bridge", () => {
  it("passes streamed binary short-circuit responses through runtime.after without corruption", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-runtime-response-"));
    temporaryRoots.add(root);

    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", "react")),
      path.join(root, "node_modules", "react"),
      "junction",
    );
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", "react-dom")),
      path.join(root, "node_modules", "react-dom"),
      "junction",
    );
    await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
    await fs.writeFile(
      path.join(root, "farm.config.ts"),
      `export default {
  plugins: [{
    name: "binary-runtime-response",
    beforeRequest(req, res) {
      if (req.url !== "/binary") return;
      res.statusCode = 200;
      res.setHeader("content-type", "application/octet-stream");
      res.write(Buffer.from([0, 255, 1]));
      res.end(Buffer.from([128, 2]));
    },
    runtime: {
      async after({ response }) {
        const bytes = Buffer.from(await response.arrayBuffer());
        const headers = new Headers(response.headers);
        headers.set("x-runtime-body", bytes.toString("hex"));
        return new Response(bytes, { status: response.status, headers });
      },
    },
  }],
};`,
    );
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

    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);
    await server.listen(0);
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");

    const response = await fetch(`http://localhost:${address.port}/binary`);
    const bytes = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-runtime-body")).toBe("00ff018002");
    expect([...bytes]).toEqual([0, 255, 1, 128, 2]);

    const pageResponse = await fetch(`http://localhost:${address.port}/`);
    expect(pageResponse.headers.get("x-runtime-body")).toMatch(/^[a-f0-9]+$/);
    await expect(pageResponse.text()).resolves.toContain("home");
  }, 30_000);
});
