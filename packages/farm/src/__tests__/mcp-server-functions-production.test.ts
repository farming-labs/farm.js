// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startDevServer } from "../server/create-server";

type Fetch = (request: Request) => Promise<Response>;

async function rpc(fetchMCP: Fetch, method: string, params?: unknown, token = "agent") {
  const response = await fetchMCP(
    new Request("http://farm.test/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  const text = await response.text();
  const data = response.headers.get("content-type")?.startsWith("text/event-stream")
    ? text
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6)
    : text;
  return { status: response.status, payload: data ? JSON.parse(data) : undefined };
}

async function verifyServerFunctionTools(fetchMCP: Fetch) {
  expect((await rpc(fetchMCP, "tools/list", undefined, "nobody")).status).toBe(401);

  const list = await rpc(fetchMCP, "tools/list");
  const tools = Object.fromEntries(list.payload.result.tools.map((tool: any) => [tool.name, tool]));
  expect(Object.keys(tools).sort()).toEqual(["contact_submit", "list_plans"]);
  expect(tools.contact_submit.inputSchema.properties).toHaveProperty("email");
  expect(tools.contact_submit.annotations).toMatchObject({ destructiveHint: true });
  expect(tools.list_plans.annotations).toMatchObject({ readOnlyHint: true });

  const submitted = await rpc(fetchMCP, "tools/call", {
    name: "contact_submit",
    arguments: { email: "ada@example.com", message: "hello" },
  });
  expect(submitted.payload.result.structuredContent).toEqual({
    result: { ticket: "ticket-ada@example.com", agent: "Bearer agent" },
  });

  const invalid = await rpc(fetchMCP, "tools/call", {
    name: "contact_submit",
    arguments: { email: "nope", message: "hello" },
  });
  expect(invalid.payload.result.isError).toBe(true);

  const failed = await rpc(fetchMCP, "tools/call", {
    name: "contact_submit",
    arguments: { email: "crash@example.com", message: "hello" },
  });
  expect(failed.payload.result).toMatchObject({
    isError: true,
    content: [{ text: "Server function failed." }],
  });
  expect(JSON.stringify(failed.payload)).not.toContain("private crash detail");

  const plans = await rpc(fetchMCP, "tools/call", {
    name: "list_plans",
    arguments: { tier: "team" },
  });
  expect(plans.payload.result.structuredContent).toEqual({
    result: [{ name: "Pro", tier: "team" }],
  });
}

describe("server functions as MCP tools", () => {
  it("serve the same tools in Vite and in the Vercel output", async () => {
    const packageRoot = process.cwd();
    const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-mcp-server-fns-"));
    try {
      await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
      for (const [name, source] of [
        ["core", packageRoot],
        ["mcp", path.resolve(packageRoot, "../farm-mcp")],
      ]) {
        await fs.symlink(source!, path.join(root, "node_modules", "@farm.js", name!), "junction");
      }
      await fs.writeFile(path.join(root, "package.json"), '{"type":"module","private":true}');
      await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
      await fs.mkdir(path.join(root, "src", "features"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        "export default function Page() { return <main>contact</main>; }",
      );
      await fs.writeFile(
        path.join(root, "src", "features", "contact.ts"),
        `
import { createServerFn, createServerMiddleware } from "@farm.js/core/server-fn";
import { createServerQuery } from "@farm.js/core/server-query";
import { z } from "zod";

const agent = createServerMiddleware({
  handler: ({ request, next }) => next({ context: { agent: request?.headers.get("authorization") ?? null } }),
});

export const submitContact = createServerFn({
  input: z.object({ email: z.string().email(), message: z.string().min(1) }),
  middleware: [agent],
  mcp: { name: "contact_submit", description: "Send a message to the sales team" },
  handler: ({ input, context }) => {
    if (input.email.startsWith("crash")) throw new Error("private crash detail");
    return { ticket: "ticket-" + input.email, agent: context.agent };
  },
});

export const listPlans = createServerQuery({
  input: z.object({ tier: z.string() }),
  key: ({ input }) => ["plans", input.tier],
  mcp: { name: "list_plans" },
  handler: ({ input }) => [{ name: "Pro", tier: input.tier }],
});
`,
      );
      await fs.writeFile(
        path.join(root, "farm.config.ts"),
        `
import { defineConfig } from "@farm.js/core";
import { submitContact, listPlans } from "./src/features/contact";
export default defineConfig({
  telemetry: false,
  images: { provider: "none" },
  vite: { server: { host: "127.0.0.1", strictPort: false } },
  mcp: {
    tools: [submitContact, listPlans],
    authorize: ({ request }) =>
      request.headers.get("authorization") === "Bearer agent" ? { subject: "agent" } : false,
  },
});
`,
      );

      const dev = await startDevServer({ root }, 0);
      try {
        const address = dev.httpServer!.address();
        if (!address || typeof address === "string") throw new Error("Dev server did not bind");
        await verifyServerFunctionTools((request) =>
          fetch(
            new Request(
              `http://127.0.0.1:${address.port}${new URL(request.url).pathname}`,
              request,
            ),
          ),
        );
      } finally {
        await dev.close();
      }

      const config = await resolveConfig(
        { ...(await loadConfig(root, undefined, "production")), root },
        "production",
      );
      await build(config, { root, preset: "vercel" });
      // The deployed function must carry the server functions without the source tree.
      await fs.rename(path.join(root, "src"), path.join(root, "source-not-deployed"));
      await fs.rename(path.join(root, "farm.config.ts"), path.join(root, "config-not-deployed.ts"));
      const entry = path.join(root, ".vercel", "output", "functions", "__nitro.func", "index.mjs");
      const server = await import(/* @vite-ignore */ pathToFileURL(entry).href);
      await verifyServerFunctionTools((request) => server.default.fetch(request));

      const clientDir = path.join(root, ".farm", "client");
      for (const file of await fs.readdir(clientDir, { recursive: true })) {
        if (!file.endsWith(".js")) continue;
        expect(await fs.readFile(path.join(clientDir, file), "utf8")).not.toContain(
          "private crash detail",
        );
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 240_000);
});
