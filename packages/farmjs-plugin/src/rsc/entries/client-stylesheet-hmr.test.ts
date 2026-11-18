import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { generateClientEntry } from "./client.js";
import type { EntryContext } from "../types.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  routesDir: "app",
  globalCssPath: "/src/app/globals.css",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 500_000 },
  deploymentId: "stylesheet-hmr-test",
  debug: false,
};

const roots: string[] = [];
const servers: ViteDevServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The stylesheet block the browser entry starts with: the ?url glob import and its accept. */
function stylesheetBlock(entry: string): string {
  const end = entry.indexOf("import React from 'react';");
  expect(end).toBeGreaterThan(0);
  return entry.slice(0, end);
}

it("accepts the global stylesheet's ?url module, which an edit does not change", () => {
  const block = stylesheetBlock(generateClientEntry(context));
  expect(block).toContain(`import.meta.hot.accept("/src/app/globals.css?url", () => {})`);
  expect(stylesheetBlock(generateClientEntry({ ...context, globalCssPath: undefined }))).toBe("\n");
});

// A dev server with the entry's stylesheet block as its browser entry: an edit to the stylesheet
// must hot-update the <link>, not reload the page. The same block without the accept is the
// control: Vite finds no boundary and answers with a full reload.
async function hotPayloadsAfterEdit(block: string): Promise<string[]> {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "farm-stylesheet-hmr-")));
  roots.push(root);
  mkdirSync(path.join(root, "src/app"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), '{"name":"app","type":"module"}');
  writeFileSync(path.join(root, "src/app/globals.css"), "body { color: red }\n");
  writeFileSync(path.join(root, "entry.js"), block);
  const server = await createServer({
    root,
    logLevel: "silent",
    configFile: false,
    server: { middlewareMode: true, watch: null },
  });
  servers.push(server);
  const client = server.environments.client;
  // The browser loads the entry (which imports the ?url module) and the <link> stylesheet.
  await client.transformRequest("/entry.js");
  await client.transformRequest("/src/app/globals.css?direct");
  const payloads: string[] = [];
  const send = client.hot.send.bind(client.hot);
  client.hot.send = ((payload: { type?: string; updates?: Array<{ type: string }> }) => {
    if (typeof payload === "object" && payload.type !== "ping") {
      payloads.push(
        payload.type === "update" ? payload.updates!.map((u) => u.type).join(",") : payload.type!,
      );
    }
    return send(payload as never);
  }) as typeof client.hot.send;
  const file = path.join(root, "src/app/globals.css");
  writeFileSync(file, "body { color: blue }\n");
  await server.watcher.emit("change", file);
  await new Promise((resolve) => setTimeout(resolve, 100));
  return payloads;
}

it("hot-updates the stylesheet link on an edit instead of reloading the page", async () => {
  const block = stylesheetBlock(generateClientEntry(context));
  const payloads = await hotPayloadsAfterEdit(block);
  expect(payloads).not.toContain("full-reload");
  expect(payloads.some((p) => p.includes("css-update"))).toBe(true);
  // Control: the block as it was before the accept reloads the page.
  const control = await hotPayloadsAfterEdit(
    block.replace(/if \(import\.meta\.hot\) \{[\s\S]*?\}\n/, ""),
  );
  expect(control).toContain("full-reload");
});
