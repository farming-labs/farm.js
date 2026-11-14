// @vitest-environment node

import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { startProductionServer, type ProductionServer } from "./production-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let root: string | undefined;
let server: ProductionServer | undefined;
let port = 0;

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** A raw request, so the test sees the bytes and encoding the server sent. */
function request(pathname: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("latin1"),
        }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

const renderedAt = (body: string) =>
  body
    .match(/data-at="([^"]+)"|"at":([\d.]+)/)
    ?.slice(1)
    .find(Boolean);

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(packageRoot, ".tmp-cache-route-rules-"));
  const write = async (relativePath: string, source: string) => {
    await fs.mkdir(path.dirname(path.join(root!, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root!, relativePath), source);
  };
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await write("package.json", '{"type":"module","private":true}');
  await write(
    "src/app/layout.tsx",
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
  );
  await write(
    "src/app/news/page.tsx",
    `export const revalidate = 60;
export default function News() { return <main data-at={String(Date.now() + Math.random())}>news</main>; }`,
  );
  // A page with no route config of its own, and one that reads a cookie.
  await write(
    "src/app/docs/page.tsx",
    "export default function Docs() { return <main data-at={String(Date.now() + Math.random())}>docs</main>; }",
  );
  await write(
    "src/app/account/page.tsx",
    `import { cookies } from "@farm.js/core/headers";
export default function Account() {
  const user = cookies().get("user")?.value ?? "anonymous";
  return <main data-at={String(Date.now() + Math.random())}>account-{user}</main>;
}`,
  );
  const api = `export function GET() {
  return Response.json({ at: Date.now() + Math.random(), pad: "x".repeat(4000) });
}`;
  await write("src/app/api/feed/route.ts", api);
  await write("src/app/api/live/route.ts", api);
  const config = await resolveConfig(
    {
      root,
      srcDir: "src",
      telemetry: false,
      images: { provider: "none" },
      deploy: { target: "node-server" },
      routeRules: {
        "/news": { swr: 60 },
        "/docs": { swr: 60 },
        "/account": { swr: 60 },
        "/api/feed": { swr: 60 },
      },
    },
    "production",
  );
  await build(config, { root, preset: "node-server" });

  server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
  port = server.port;
}, 180_000);

afterAll(async () => {
  // Windows refuses to remove the output while the server still holds it as its cwd.
  await server?.stop();
  if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("swr route rules on a Node server", () => {
  it("stores a shareable page and serves the stored render", async () => {
    const browser = { accept: "text/html", "accept-encoding": "gzip, br" };
    const first = await request("/news", browser);
    const second = await request("/news", browser);
    expect(first.status, server?.output()).toBe(200);
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(renderedAt(second.body)).toBe(renderedAt(first.body));
    // The stored body is sent as it is: never compressed bytes without a Content-Encoding.
    expect(second.headers["content-encoding"]).toBeUndefined();
    expect(second.body).toContain("news");
  });

  it("stores a page that has no route config and reads nothing of the request", async () => {
    const first = await request("/docs", { accept: "text/html" });
    const second = await request("/docs", { accept: "text/html" });
    expect(first.status, server?.output()).toBe(200);
    expect(first.headers["set-cookie"]).toBeUndefined();
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(renderedAt(second.body)).toBe(renderedAt(first.body));
    expect(second.headers["cache-control"]).toContain("s-maxage=60");
    expect(second.headers["cache-control"]).not.toMatch(/private|no-store/);
  });

  it("keeps a page that reads cookies private and out of the rule's cache", async () => {
    const browser = { accept: "text/html", cookie: "user=alice" };
    const first = await request("/account", browser);
    const second = await request("/account", browser);
    const anonymous = await request("/account", { accept: "text/html" });
    for (const response of [first, second, anonymous]) {
      expect(response.status, server?.output()).toBe(200);
      expect(response.headers["x-cache"]).not.toBe("HIT");
      // Farm's private policy reaches the client, not the rule's public one.
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
    expect(renderedAt(second.body)).not.toBe(renderedAt(first.body));
  });

  it("keys the stored page on Accept, so a Markdown request gets Markdown", async () => {
    await request("/news", { accept: "text/html" });
    const markdown = await request("/news", { accept: "text/markdown" });
    expect(markdown.headers["content-type"]).toContain("text/markdown");
  });

  it("stores an API response, with compression left to the cache layer", async () => {
    const first = await request("/api/feed", { "accept-encoding": "gzip" });
    const second = await request("/api/feed", { "accept-encoding": "gzip" });
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(renderedAt(second.body)).toBe(renderedAt(first.body));
    expect(second.headers["content-encoding"]).toBeUndefined();
    expect(JSON.parse(second.body).pad).toHaveLength(4000);
  });

  it("still compresses a route no cache rule covers", async () => {
    const live = await request("/api/live", { "accept-encoding": "gzip" });
    expect(live.headers["content-encoding"]).toBe("gzip");
    expect(live.headers["x-cache"]).toBeUndefined();
  });
});
