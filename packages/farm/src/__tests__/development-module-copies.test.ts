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

// An app that links `@farm.js/core` from the workspace, as every example does. In development its
// pages, routes, and server functions run under Vite's SSR runner, which loads its own copy of
// core's modules, while the dev server runs on another. State one copy writes and the other reads
// has to live on `globalThis`, or on the shared object under a `Symbol.for` key.

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

const MOBILE = { id: "com.example.counter", server: "https://counter.example.com" };
const THEME = { default: "dark", storageKey: "fx-theme" } as const;

const PARITY_APP: Record<string, string> = {
  "src/app/layout.tsx": `export default function Layout({ children }) {
  return <html><body>{children}</body></html>;
}`,
  "src/app/page.tsx": `import { getTheme } from "@farm.js/core/theme/server";
import { ThemeName } from "../theme-name";
export default function Page() {
  return <main><p>server:{getTheme()}</p><ThemeName /></main>;
}`,
  "src/app/plain/page.tsx": `import { ThemeName } from "../../theme-name";
export default function Plain() {
  return <main><ThemeName /></main>;
}`,
  "src/theme-name.tsx": `"use client";
import { useTheme } from "@farm.js/core/theme/client";
export function ThemeName() {
  return <p>client:{useTheme().theme}</p>;
}`,
  "src/app/m/page.tsx": "export default function Counter() { return <p>Counter</p>; }",
  "src/app/m/page.native.tsx": `import { double } from "../../server";
export default function Counter() { return [double]; }
`,
  // A schema with safeParse, the shape zod and valibot adapters provide.
  "src/server.ts": `import { createServerFn } from "@farm.js/core/server-fn";
export const double = createServerFn({
  input: {
    safeParse: (value) =>
      typeof value?.n === "number"
        ? { success: true, data: value }
        : { success: false, error: Object.assign(new Error("n must be a number"), { issues: [{ path: ["n"], message: "n must be a number" }] }) },
  },
  handler: async ({ input }) => input.n * 2,
});
`,
};

async function createApp(files: Record<string, string>): Promise<string> {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-module-copies-")),
  );
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
  for (const [file, contents] of Object.entries({
    "package.json": '{"private":true,"type":"module"}',
    ...files,
  })) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), contents);
  }
  return root;
}

type Fetch = (pathname: string, init?: RequestInit) => Promise<Response>;

async function startDevelopment(
  root: string,
  config: Record<string, unknown> = {},
): Promise<{ fetch: Fetch; origin: string }> {
  const server = await createServer({ root, images: { provider: "none" }, ...config });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  const origin = `http://localhost:${address.port}`;
  return { origin, fetch: (pathname, init) => fetch(`${origin}${pathname}`, init) };
}

async function startProduction(root: string, config: Record<string, unknown>): Promise<Fetch> {
  const resolved = await resolveConfig(
    {
      root,
      srcDir: "src",
      images: { provider: "none" },
      telemetry: false,
      deploy: { target: "vercel" },
      ...config,
    },
    "production",
  );
  await build(resolved, { root, preset: "vercel" });
  const functionRoot = path.resolve(root, resolved.deploy.outputDir, "functions", "__nitro.func");
  const { default: handler } = await import(
    /* @vite-ignore */ pathToFileURL(path.join(functionRoot, "index.mjs")).href
  );
  return (pathname, init) => handler.fetch(new Request(`${MOBILE.server}${pathname}`, init));
}

async function readThemes(request: Fetch, pathname: string, cookie?: string) {
  const html = await request(pathname, cookie ? { headers: { cookie } } : undefined).then(
    (response) => response.text(),
  );
  return {
    html: /<html[^>]*data-theme="(\w+)"/.exec(html)?.[1],
    server: /server:(?:<!-- -->)?(\w+)/.exec(html)?.[1],
    client: /client:(?:<!-- -->)?(\w+)/.exec(html)?.[1],
  };
}

async function expectConfiguredTheme(request: Fetch): Promise<void> {
  expect(await readThemes(request, "/")).toEqual({
    html: "dark",
    server: "dark",
    client: "dark",
  });
  expect(await readThemes(request, "/", "fx-theme=light")).toEqual({
    html: "light",
    server: "light",
    client: "light",
  });
  // A page that never imports the server module, rendered after one that did.
  expect(await readThemes(request, "/plain", "fx-theme=light")).toEqual({
    html: "light",
    server: undefined,
    client: "light",
  });
}

function nativeCall(id: string, input: unknown) {
  return { id, input };
}

/** Node's `fetch` sends fetch metadata, which the native endpoint refuses as a browser's. */
function postNative(url: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const text = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(text)),
          "x-farm-mobile": MOBILE.id,
        },
      },
      (response) => {
        let received = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (received += chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(received) }),
        );
      },
    );
    request.on("error", reject);
    request.end(text);
  });
}

const INVALID_INPUT = {
  status: 400,
  body: { error: { code: "invalid_input", message: "n must be a number" } },
};

describe("development with a linked @farm.js/core", () => {
  it("renders the configured theme in getTheme() and useTheme()", async () => {
    const root = await createApp(PARITY_APP);
    const { fetch } = await startDevelopment(root, { theme: THEME, mobile: MOBILE });
    await expectConfiguredTheme(fetch);
  }, 60_000);

  it("answers a native server function's invalid input with 400 invalid_input", async () => {
    const root = await createApp(PARITY_APP);
    const { origin } = await startDevelopment(root, { theme: THEME, mobile: MOBILE });
    const id = farmNativeServerFnId(root, path.join(root, "src/server.ts"), "double");
    const endpoint = `${origin}/api/__farm/native/fn`;

    expect(await postNative(endpoint, nativeCall(id, { n: 2 }))).toEqual({
      status: 200,
      body: { data: 4 },
    });
    expect(await postNative(endpoint, nativeCall(id, { n: "x" }))).toMatchObject(INVALID_INPUT);
  }, 60_000);

  it("sends a resolved defer() the render never read to the client as fulfilled", async () => {
    const root = await createApp({
      "src/app/layout.tsx": `export default function Layout({ children }) {
  return <html><body>{children}</body></html>;
}`,
      "src/farm.routes.tsx": `import { createRoute, defer, defineRoutes } from "@farm.js/core";
import { DeferredPage } from "./deferred-page";
export const Deferred = createRoute("/deferred", {
  data: {
    main() {
      return { reviews: defer(Promise.resolve("five stars")) };
    },
  },
  component: DeferredPage,
});
export default defineRoutes(() => [Deferred]);`,
      "src/deferred-page.tsx": `import { Reviews } from "./reviews";
export function DeferredPage() {
  return <main><Reviews /></main>;
}`,
      // Reads the deferred only after a click, so the server render never touches it.
      "src/reviews.tsx": `"use client";
export function Reviews() {
  return <button type="button">show reviews</button>;
}`,
    });
    const { fetch } = await startDevelopment(root);

    const html = await fetch("/deferred").then((response) => response.text());
    const settlements = /__FARM_DEFERRED_DATA__\s*=\s*(\{.*?\});?<\/script>/s.exec(html)?.[1];
    expect(settlements && JSON.parse(settlements)).toEqual({
      d0: { status: "fulfilled", value: "five stars" },
    });
  }, 60_000);
});

describe("production, for comparison", () => {
  it("renders the configured theme and answers invalid native input with 400", async () => {
    const root = await createApp(PARITY_APP);
    const request = await startProduction(root, { theme: THEME, mobile: MOBILE });
    await expectConfiguredTheme(request);

    const id = farmNativeServerFnId(root, path.join(root, "src/server.ts"), "double");
    const response = await request("/api/__farm/native/fn", {
      method: "POST",
      headers: { "content-type": "application/json", "x-farm-mobile": MOBILE.id },
      body: JSON.stringify(nativeCall(id, { n: "x" })),
    });
    expect({ status: response.status, body: await response.json() }).toMatchObject(INVALID_INPUT);
  }, 180_000);
});
