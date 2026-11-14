// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

// A docs adapter builds each page from an HTML string it holds. The production server hands it
// `createHtmlResponse`, so the page keeps that string: the preload budget scans it and the server
// writes it without reading the body back and encoding it again (#2720: ~340 KB per docs page).

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Counts every time a page's body is read back into a string or bytes, on whichever Response
 * Farm reads: the server copies a response it does not own before reading it.
 */
const ADAPTER_SERVER = `let bodyReads = 0;
let ownedHtml = false;
for (const method of ["text", "arrayBuffer", "bytes"]) {
  const read = Response.prototype[method];
  if (!read) continue;
  Response.prototype[method] = async function (...args) {
    const value = await read.apply(this, args);
    const text = typeof value === "string" ? value : new TextDecoder().decode(value);
    if (text.includes("data-docs-page=")) bodyReads++;
    return value;
  };
}
const html = (pathname) =>
  '<!doctype html><html><head><link rel="modulepreload" href="/docs-chunk.js"></head>' +
  '<body><main data-docs-page="' + pathname + '">' + "x".repeat(200000) + "</main></body></html>";

export function createFarmDocsRuntimeHandler(config, options) {
  ownedHtml = typeof options.createHtmlResponse === "function";
  return async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/docs-reads") return Response.json({ bodyReads, ownedHtml });
    if (!pathname.startsWith("/docs/")) return null;
    const init = {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "X-Farm-Docs-Adapter": "fake" },
    };
    return options.createHtmlResponse
      ? options.createHtmlResponse(html(pathname), init)
      : new Response(html(pathname), init);
  };
}
`;

async function write(root: string, relativePath: string, source: string) {
  await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
  await fs.writeFile(path.join(root, relativePath), source);
}

async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-docs-adapter-html-"));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  await write(
    root,
    "node_modules/fake-docs-adapter/package.json",
    JSON.stringify({
      name: "fake-docs-adapter",
      type: "module",
      exports: { "./server": "./server.js", "./react": "./react.js" },
    }),
  );
  await write(root, "node_modules/fake-docs-adapter/server.js", ADAPTER_SERVER);
  await write(
    root,
    "node_modules/fake-docs-adapter/react.js",
    "export function hydrateFarmDocs() {}",
  );
  await write(root, "package.json", '{"type":"module","private":true}');
  await write(root, "docs.config.ts", 'export default { entry: "docs" };\n');
  await write(
    root,
    "src/app/layout.tsx",
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
  );
  await write(root, "src/app/page.tsx", "export default function Page() { return <p>home</p>; }");
  return root;
}

async function withProductionServer(
  serverDir: string,
  run: (origin: string) => Promise<void>,
): Promise<void> {
  const server = await startProductionServer(serverDir);
  try {
    await run(server.origin);
  } finally {
    await server.stop();
  }
}

describe("docs adapter pages in production", () => {
  it("serves a page the adapter built with createHtmlResponse without reading its body back", async () => {
    const root = await createFixture();
    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          docs: {
            enabled: true,
            entry: "/docs",
            adapter: {
              id: "fake",
              protocol: 1,
              server: "fake-docs-adapter/server",
              react: "fake-docs-adapter/react",
            },
          },
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      await withProductionServer(path.join(root, ".farm", ".output", "server"), async (origin) => {
        const anonymous = await fetch(`${origin}/docs/guide`);
        expect(anonymous.status).toBe(200);
        const anonymousHtml = await anonymous.text();
        expect(anonymousHtml).toContain('<main data-docs-page="/docs/guide">');
        expect(anonymousHtml.length).toBeGreaterThan(200_000);
        expect(anonymous.headers.get("x-farm-preload-buffered")).toBeNull();
        expect(anonymous.headers.get("cache-control") ?? "").not.toContain("private");

        // A visitor with a cookie gets the page marked private, from the same string.
        const visitor = await fetch(`${origin}/docs/guide`, { headers: { cookie: "session=1" } });
        expect(visitor.status).toBe(200);
        expect(visitor.headers.get("cache-control")).toBe("private, no-store");
        expect(await visitor.text()).toBe(anonymousHtml);

        const reads = await (await fetch(`${origin}/docs-reads`)).json();
        expect(reads).toEqual({ bodyReads: 0, ownedHtml: true });
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 180_000);
});
