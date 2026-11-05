// @vitest-environment node

import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { build } from "../build";
import { resolveConfig } from "../config";
import { farmNativeServerFnId } from "../mobile/native-server-fns";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all(
    [...roots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  roots.clear();
});

const MOBILE = { id: "com.example.notes", server: "https://notes.example.com" };

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-native-fns-server-"));
  roots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  const files: Record<string, string> = {
    "package.json": '{"private":true,"type":"module"}',
    "src/app/layout.tsx": "export default function Layout({ children }) { return children; }",
    "src/app/notes/page.tsx": "export default function Notes() { return <p>Notes</p>; }",
    // Web builds never read this file; the server only learns which functions it imports.
    "src/app/notes/page.native.tsx": `import { createNote, whoami } from "../../features/notes/server";
export default function Notes() { return [createNote, whoami]; }
`,
    "src/features/notes/store.ts": "export const notes: Array<{ title: string }> = [];\n",
    "src/features/notes/server.ts": `import { createServerFn } from "@farm.js/core/server-fn";
import { notes } from "./store";
export const createNote = createServerFn({
  handler: async ({ input }) => {
    if (!input?.title) throw new Error("no title");
    notes.push({ title: input.title });
    return { count: notes.length };
  },
});
// The call's request, after the app's runtime.before hooks (a session plugin's, say).
export const whoami = createServerFn({
  handler: async ({ request }) => ({ user: request?.headers.get("x-user") ?? null }),
});
`,
    // Never imported by a native screen: not open to them.
    "src/features/admin/server.ts": `import { createServerFn } from "@farm.js/core/server-fn";
export const wipe = createServerFn({ handler: async () => "wiped" });
`,
    "src/app/admin/page.tsx": `import { wipe } from "../../features/admin/server";
export default function Admin() { return <p>{String(Boolean(wipe))}</p>; }
`,
    "src/app/api/notes/route.ts": `import { notes } from "../../../features/notes/store";
export const GET = () => Response.json(notes);
`,
  };
  for (const [file, contents] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), contents);
  }
  return root;
}

function ids(root: string) {
  return {
    createNote: farmNativeServerFnId(
      root,
      path.join(root, "src/features/notes/server.ts"),
      "createNote",
    ),
    whoami: farmNativeServerFnId(root, path.join(root, "src/features/notes/server.ts"), "whoami"),
    wipe: farmNativeServerFnId(root, path.join(root, "src/features/admin/server.ts"), "wipe"),
  };
}

/**
 * A POST as the app sends it. Node's `fetch` adds `Sec-Fetch-Mode` as a browser does, which the
 * endpoint refuses; React Native's does not, so the dev server test posts with `node:http`.
 */
function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = { "x-farm-mobile": MOBILE.id },
): Promise<{ status: number; json: () => unknown }> {
  const text = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(text)),
          ...headers,
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, json: () => JSON.parse(text) }),
        );
      },
    );
    request.on("error", reject);
    request.end(text);
  });
}

function call(id: string, input: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", "x-farm-mobile": MOBILE.id },
    body: JSON.stringify({ id, input }),
  };
}

describe("server functions called from native screens", () => {
  it("run in development, sharing module state with the app's API routes", async () => {
    const root = await createApp();
    const server = await createServer({
      root,
      images: { provider: "none" },
      mobile: MOBILE,
      // Stands in for the mobile session plugin, which turns a device token into the user's
      // session in a `before` hook: the call is an API route, so the hook runs first.
      plugins: [
        {
          name: "test-user",
          runtime: {
            before: ({ request }: { request: Request }) => {
              const headers = new Headers(request.headers);
              headers.set("x-user", "ada");
              return new Request(request, { headers });
            },
          },
        },
      ],
    });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;
    const { createNote, whoami, wipe } = ids(root);

    const endpoint = `${origin}/api/__farm/native/fn`;
    expect((await post(endpoint, { id: whoami, input: null })).json()).toEqual({
      data: { user: "ada" },
    });
    const created = await post(endpoint, { id: createNote, input: { title: "Creek" } });
    expect(created.status).toBe(200);
    expect(created.json()).toEqual({ data: { count: 1 } });
    // The API route reads the same store the function wrote.
    expect(await fetch(`${origin}/api/notes`).then((response) => response.json())).toEqual([
      { title: "Creek" },
    ]);
    expect((await post(endpoint, { id: wipe, input: null })).status).toBe(404);
    // Farm's own transport stays out of the app's typed API client.
    const apiTypes = await fs.readFile(path.join(root, "src/lib/api.generated.ts"), "utf8");
    expect(apiTypes).toContain('"/api/notes"');
    expect(apiTypes).not.toContain("__farm");
    expect(apiTypes).not.toContain("PluginAPIRouter");
    // A browser cannot call it: its fetch sends fetch metadata.
    const browser = await fetch(endpoint, call(createNote, { title: "x" }));
    expect(browser.status).toBe(403);
  }, 60_000);

  it("run from the production server, which holds only the functions native screens import", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      {
        root,
        srcDir: "src",
        images: { provider: "none" },
        telemetry: false,
        deploy: { target: "vercel" },
        mobile: MOBILE,
      },
      "production",
    );
    await build(config, { root, preset: "vercel" });
    const functionRoot = path.resolve(root, config.deploy.outputDir, "functions", "__nitro.func");
    const { default: handler } = await import(
      /* @vite-ignore */ pathToFileURL(path.join(functionRoot, "index.mjs")).href
    );
    const { createNote, wipe } = ids(root);
    const endpoint = "https://notes.example.com/api/__farm/native/fn";
    const created = await handler.fetch(
      new Request(endpoint, call(createNote, { title: "Creek" })),
    );
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ data: { count: 1 } });
    // `wipe` is in the server bundle for the admin page, but no native screen imports it.
    expect((await handler.fetch(new Request(endpoint, call(wipe, null)))).status).toBe(404);
    const error = await handler.fetch(new Request(endpoint, call(createNote, {})));
    expect(error.status).toBe(500);
    expect(await error.text()).not.toContain("no title");
  }, 120_000);
});
