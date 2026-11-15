// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

/**
 * The development deployment cookie is `Secure` for an https request, and a client-sent
 * `X-Forwarded-Proto` names one only behind a trusted proxy (`server.trustProxy`), as in
 * production. It used to trust the header from any client.
 */
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

async function startApp(trustProxy: boolean): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-dev-deployment-cookie-"));
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
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    "export default function Home() { return <main>home</main>; }",
  );
  const server = await createServer({
    root,
    images: { provider: "none" },
    telemetry: false,
    server: { trustProxy },
  });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return `http://localhost:${address.port}`;
}

async function deploymentCookie(origin: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${origin}/`, { headers });
  expect(response.status).toBe(200);
  return response.headers.getSetCookie().find((cookie) => cookie.startsWith("__farm_deployment="));
}

describe("the development deployment cookie", () => {
  it("ignores a client-sent X-Forwarded-Proto without trustProxy", async () => {
    const origin = await startApp(false);
    expect(await deploymentCookie(origin)).not.toContain("Secure");
    expect(await deploymentCookie(origin, { "x-forwarded-proto": "https" })).not.toContain(
      "Secure",
    );
  }, 60_000);

  it("is Secure for a trusted proxy's forwarded https", async () => {
    const origin = await startApp(true);
    expect(await deploymentCookie(origin)).not.toContain("Secure");
    expect(await deploymentCookie(origin, { "x-forwarded-proto": "https" })).toMatch(/; Secure$/);
  }, 60_000);
});
