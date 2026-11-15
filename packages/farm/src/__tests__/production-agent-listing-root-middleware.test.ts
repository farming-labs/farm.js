// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";
import { startProductionServer, type ProductionServer } from "./production-server";

/**
 * A Next.js-style root `src/app/middleware.ts` whose own `config.matcher` names the pages it
 * guards. The pages redirect a signed-out visitor, and the public listings (sitemap.xml,
 * llms.txt, the default MCP server) must not publish their path, title or description either.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SECRET = "SECRET_q3_layoffs_list";
const FILES: Record<string, string> = {
  "package.json": '{"type":"module","private":true}',
  "farm.config.ts": `export default { images: { provider: "none" }, telemetry: false };`,
  "src/app/layout.tsx":
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
  "src/app/page.tsx": `export const metadata = { title: "Home" };
export default function Home() { return <main>home</main>; }`,
  "src/app/pricing/page.tsx": `export const metadata = { title: "Pricing", description: "public pricing" };
export default function Pricing() { return <main>pricing</main>; }`,
  "src/app/dashboard/payroll/page.tsx": `export const metadata = { title: "Payroll export", description: ${JSON.stringify(SECRET)} };
export default function Payroll() { return <main>payroll</main>; }`,
  "src/app/middleware.ts": `export const config = { matcher: ["/dashboard/:path*"] };
export function middleware(request: Request) {
  if (!request.headers.get("cookie")?.includes("session=")) {
    return Response.redirect(new URL("/", request.url), 307);
  }
}`,
};

const roots: string[] = [];

async function createApp(): Promise<string> {
  // Inside the package so the pages resolve React through the workspace.
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-agent-listing-root-middleware-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const [relativePath, source] of Object.entries(FILES)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

const mcpCall = (name: string, args: object): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  }),
});

/** Every public listing the app serves, as one string, plus the guarded page's own status. */
async function readListings(origin: string): Promise<{ listings: string; guardedStatus: number }> {
  const guarded = await fetch(`${origin}/dashboard/payroll`, { redirect: "manual" });
  const bodies = await Promise.all(
    [
      fetch(`${origin}/sitemap.xml`),
      fetch(`${origin}/llms.txt`),
      fetch(`${origin}/mcp`, mcpCall("list_pages", {})),
      fetch(`${origin}/mcp`, mcpCall("search_pages", { query: "payroll" })),
    ].map(async (pending) => {
      const response = await pending;
      expect(response.status).toBe(200);
      return response.text();
    }),
  );
  return { listings: bodies.join("\n"), guardedStatus: guarded.status };
}

function expectGuardedPageUnlisted({
  listings,
  guardedStatus,
}: {
  listings: string;
  guardedStatus: number;
}) {
  // The guard itself holds, as before.
  expect(guardedStatus).toBe(307);
  // The public page is still listed, so the listings did not just go empty.
  expect(listings).toContain("/pricing");
  expect(listings).not.toContain("/dashboard/payroll");
  expect(listings).not.toContain("Payroll export");
  expect(listings).not.toContain(SECRET);
}

let server: ProductionServer | undefined;

afterAll(async () => {
  // Windows refuses to remove the output while the server still holds it as its cwd.
  await server?.stop();
  await Promise.all(
    roots.map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
    ),
  );
});

describe("a root middleware.ts whose matcher names the pages it guards", () => {
  let origin = "";

  beforeAll(async () => {
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
      "production",
    );
    await build(config, { root, preset: "node-server" });

    server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
    origin = server.origin;
  }, 180_000);

  it("keeps the pages out of a production build's listings", async () => {
    expectGuardedPageUnlisted(await readListings(origin));
  });

  it("keeps the pages out of the development server's listings", async () => {
    const root = await createApp();
    const devServer = await createServer({ root } as never);
    const port = await getAvailablePort();
    await devServer.listen(port);
    try {
      expectGuardedPageUnlisted(await readListings(`http://127.0.0.1:${port}`));
    } finally {
      await devServer.close();
    }
  }, 180_000);
});
