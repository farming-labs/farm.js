// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startDevServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

// An MCP tool backed by an app endpoint called the endpoint directly, so the
// middleware guarding its path (a config matcher for /api/admin/**, or a
// src/app/api/reports/middleware.ts file) never ran: any caller `authorize`
// accepted read the guarded data. The tool now goes through the app pipeline.

const FARM_CONFIG = `
import { defineConfig, defineIntegration } from "@farm.js/core";
import { GET as listUsers } from "./src/app/api/admin/users/route";
import { GET as listReports } from "./src/app/api/reports/route";
import { GET as listPartners } from "./src/app/api/partners/route";

// The shape an auth integration's protectedRoutes compiles into.
const partnerGuard = defineIntegration({
  category: "auth",
  type: "partner-guard",
  middleware: [
    {
      matcher: ["/api/partners(.*)"],
      handler(request) {
        if (!request.headers.get("cookie")?.includes("role=admin")) {
          return new Response("admins only", { status: 403 });
        }
      },
    },
  ],
});

export default defineConfig({
  telemetry: false,
  images: { provider: "none" },
  vite: { server: { host: "127.0.0.1", strictPort: false } },
  integrations: { partnerGuard },
  middleware: [
    {
      matcher: "/api/admin/:path*",
      handler(ctx) {
        const cookie = ctx.request.headers.get?.("cookie") ?? ctx.request.headers.cookie ?? "";
        if (!cookie.includes("role=admin")) {
          return new Response("admins only", { status: 403 });
        }
      },
    },
  ],
  mcp: {
    name: "guarded",
    tools: [
      { endpoint: listUsers, name: "admin_list_users" },
      { endpoint: listReports, name: "list_reports" },
      { endpoint: listPartners, name: "list_partners" },
    ],
    // The documented policy: any signed-in session may use MCP.
    authorize: ({ request }) =>
      request.headers.get("cookie")?.includes("session=") ? { subject: "user" } : false,
  },
});
`;

async function createFixture(): Promise<string> {
  const packageRoot = process.cwd();
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-mcp-endpoint-middleware-"));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  for (const [name, source] of [
    ["core", packageRoot],
    ["mcp", path.resolve(packageRoot, "../farm-mcp")],
  ] as const) {
    await fs.symlink(source, path.join(root, "node_modules", "@farm.js", name), "junction");
  }
  for (const dependency of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", dependency)),
      path.join(root, "node_modules", dependency),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module","private":true}');
  await fs.writeFile(path.join(root, "farm.config.ts"), FARM_CONFIG);
  const write = async (relativePath: string, source: string) => {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  };
  await write("src/app/page.tsx", "export default function Page() { return <main>home</main>; }");
  await write(
    "src/app/api/admin/users/route.ts",
    `import { createEndpoint } from "@farm.js/core/api";
export const GET = createEndpoint("/api/admin/users", { method: "GET" }, () => ({ users: ["ADMIN-ONLY-USER"] }));
`,
  );
  await write(
    "src/app/api/reports/route.ts",
    `import { createEndpoint } from "@farm.js/core/api";
export const GET = createEndpoint("/api/reports", { method: "GET" }, () => ({ reports: ["ADMIN-ONLY-REPORT"] }));
`,
  );
  await write(
    "src/app/api/partners/route.ts",
    `import { createEndpoint } from "@farm.js/core/api";
export const GET = createEndpoint("/api/partners", { method: "GET" }, () => ({ partners: ["ADMIN-ONLY-PARTNER"] }));
`,
  );
  await write(
    "src/app/api/reports/middleware.ts",
    `export default function middleware(ctx) {
  const cookie = ctx.request.headers.get?.("cookie") ?? ctx.request.headers.cookie ?? "";
  if (!cookie.includes("role=admin")) return new Response("admins only", { status: 403 });
}
`,
  );
  return root;
}

const TOOLS = {
  admin_list_users: { path: "/api/admin/users", secret: "ADMIN-ONLY-USER" },
  list_reports: { path: "/api/reports", secret: "ADMIN-ONLY-REPORT" },
  list_partners: { path: "/api/partners", secret: "ADMIN-ONLY-PARTNER" },
};

/** Each tool answers a regular session exactly as a direct request for its endpoint does. */
async function expectToolsMatchDirectRequests(
  send: (request: Request) => Promise<Response>,
  expectRefused: readonly (keyof typeof TOOLS)[],
) {
  const call = async (name: string, cookie: string) => {
    const response = await send(
      new Request("http://farm.test/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-11-25",
          cookie,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: {} },
        }),
      }),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    const data = response.headers.get("content-type")?.startsWith("text/event-stream")
      ? text
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.slice(6)
      : text;
    return { body: data!, result: JSON.parse(data!).result };
  };

  for (const [tool, { path: endpointPath, secret }] of Object.entries(TOOLS)) {
    const direct = await send(
      new Request(`http://farm.test${endpointPath}`, { headers: { cookie: "session=regular" } }),
    );
    const directRefused = direct.status === 403;
    await direct.body?.cancel();
    expect({ tool, directRefused }).toEqual({
      tool,
      directRefused: expectRefused.includes(tool as keyof typeof TOOLS),
    });

    const regular = await call(tool, "session=regular");
    expect({ tool, isError: Boolean(regular.result.isError) }).toEqual({
      tool,
      isError: directRefused,
    });
    if (directRefused) {
      expect(regular.body).not.toContain(secret);
      expect(regular.body).toContain("403");
    }

    const admin = await call(tool, "session=admin; role=admin");
    expect(admin.result.isError).toBeFalsy();
    expect(admin.body).toContain(secret);
  }
}

describe("MCP endpoint tools run the endpoint's middleware", () => {
  it("in development and in a production build", async () => {
    const root = await createFixture();
    try {
      const dev = await startDevServer({ root }, await getAvailablePort());
      try {
        const address = dev.httpServer!.address();
        if (!address || typeof address === "string") throw new Error("Dev server did not bind");
        // Development runs integration guards for API routes; app middleware guards them in
        // production builds only, and a tool gets exactly what a direct request gets.
        await expectToolsMatchDirectRequests(
          (request) =>
            fetch(
              new Request(
                `http://127.0.0.1:${address.port}${new URL(request.url).pathname}`,
                request,
              ),
            ),
          ["list_partners"],
        );
      } finally {
        await dev.close();
      }

      const config = await resolveConfig(
        { ...(await loadConfig(root, undefined, "production")), root },
        "production",
      );
      await build(config, { root, preset: "vercel" });
      const entry = path.join(root, ".vercel", "output", "functions", "__nitro.func", "index.mjs");
      const server = await import(/* @vite-ignore */ pathToFileURL(entry).href);
      await expectToolsMatchDirectRequests(
        (request) => server.default.fetch(request),
        ["admin_list_users", "list_reports", "list_partners"],
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }, 180_000);
});
