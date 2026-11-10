// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";

// Header steps after a render edit responses Farm created in place (RFC 0002).
// These requests check that nothing repeats across requests, that app responses
// are never modified, and that streaming, HEAD and compression keep working.

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

const files: Record<string, string> = {
  "package.json": JSON.stringify({
    private: true,
    type: "module",
    dependencies: { "@farm.js/core": "workspace:*" },
  }),
  "src/app/globals.css": "",
  // Farm writes the document around this layout, so a suspending page streams.
  "src/app/layout.tsx": `export default function Layout({ children }) { return <div id="layout">{children}</div>; }`,
  "src/app/page.tsx": `export default function Page() { return <main>owned page, café ☕</main>; }`,
  "src/app/stream/page.tsx": `
import { Suspense } from "react";

async function Slow() {
  await new Promise((resolve) => setTimeout(resolve, 30));
  return <p>slow part</p>;
}

export default function Page() {
  return <main><h1>stream page</h1><Suspense fallback={<p>loading</p>}><Slow /></Suspense></main>;
}
`,
  "src/app/middleware.ts": `
import { middleware } from "@farm.js/core/middleware";

export default middleware().use(async (ctx, next) => {
  ctx.headers.set("x-middleware", "1");
  ctx.cookies.set("visit", "1");
  await next();
});
`,
  "src/app/api/shared/route.ts": `
// One Response object returned on every request.
const shared = new Response(null, { status: 204, headers: { "x-app": "1" } });
globalThis.__farmSharedResponse = shared;
export async function GET() { return shared; }
`,
  "src/app/api/inspect/route.ts": `
export async function GET() {
  return Response.json([...(globalThis.__farmSharedResponse?.headers ?? [])]);
}
`,
};

// fetch hides the transfer framing; read it off the wire.
function rawGet(
  url: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: init.method ?? "GET", headers: init.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

const headerCount = (response: Response, name: string) =>
  (response.headers.get(name) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

describe("production responses Farm owns", () => {
  let root = "";
  let base = "";
  let server: ReturnType<typeof spawn> | undefined;
  const output: string[] = [];

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-owned-response-"));
    await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
    await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
    for (const name of ["react", "react-dom"]) {
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", name)),
        path.join(root, "node_modules", name),
        "junction",
      );
    }
    for (const [file, source] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), source.trim());
    }

    const config = await resolveConfig(
      {
        root,
        srcDir: "src",
        images: { provider: "none" },
        headers: () => [
          { source: "/", headers: [{ key: "x-configured", value: "1" }] },
          { source: "/stream", headers: [{ key: "x-configured", value: "1" }] },
        ],
        generateBuildId: () => "owned-response-test",
      },
      "production",
    );
    await build(config, { root, preset: "node-server" });

    const serverDirectory = path.join(root, ".farm", ".output", "server");
    const port = await getAvailablePort();
    base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [path.join(serverDirectory, "index.mjs")], {
      cwd: serverDirectory,
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (chunk) => output.push(String(chunk)));
    server.stderr?.on("data", (chunk) => output.push(String(chunk)));
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        await fetch(`${base}/api/inspect`);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    throw new Error(`Production server did not start\n${output.join("")}`);
  }, 180_000);

  afterAll(async () => {
    // Windows keeps the server directory locked until the process has exited.
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = new Promise((resolve) => server?.once("exit", resolve));
      server.kill();
      await exited;
    }
    if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("adds each header once, request after request", async () => {
    for (let request = 0; request < 3; request++) {
      const response = await fetch(`${base}/`, { headers: { "accept-encoding": "identity" } });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("owned page, café ☕");
      expect(response.headers.get("link")).toBe(
        '</index.md>; rel="alternate"; type="text/markdown"',
      );
      expect(headerCount(response, "vary").sort()).toEqual(["Accept", "Accept-Encoding"]);
      expect(response.headers.get("x-middleware")).toBe("1");
      expect(response.headers.get("x-configured")).toBe("1");
      expect(
        response.headers.getSetCookie().filter((cookie) => cookie.startsWith("visit=")),
      ).toHaveLength(1);
    }
  });

  it("keeps the headers and sends no body for HEAD", async () => {
    const response = await fetch(`${base}/`, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("link")).toBe('</index.md>; rel="alternate"; type="text/markdown"');
    expect(response.headers.get("x-middleware")).toBe("1");
    expect(await response.text()).toBe("");
  });

  it("streams a suspending page with the same headers", async () => {
    const response = await fetch(`${base}/stream`, { headers: { "accept-encoding": "identity" } });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("stream page");
    expect(body).toContain("slow part");
    expect(response.headers.get("x-middleware")).toBe("1");
    expect(response.headers.get("link")).toBe(
      '</stream.md>; rel="alternate"; type="text/markdown"',
    );
  });

  it("compresses an owned page and lists Accept-Encoding once", async () => {
    const response = await fetch(`${base}/`, { headers: { "accept-encoding": "gzip" } });
    expect(response.status).toBe(200);
    // fetch decompresses transparently; the header shows what the server sent.
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(await response.text()).toContain("owned page, café ☕");
    expect(
      headerCount(response, "vary").filter((value) => value === "Accept-Encoding"),
    ).toHaveLength(1);
  });

  it("never modifies a Response the app returns on every request", async () => {
    for (let request = 0; request < 3; request++) {
      const response = await fetch(`${base}/api/shared`);
      expect(response.status).toBe(204);
      expect(response.headers.get("x-app")).toBe("1");
      expect(response.headers.get("x-middleware")).toBe("1");
    }
    const inspected = await (await fetch(`${base}/api/inspect`)).json();
    expect(inspected).toEqual([["x-app", "1"]]);
  });

  it("sends a buffered page in one piece with its byte length", async () => {
    const response = await rawGet(`${base}/`, { headers: { "accept-encoding": "identity" } });
    expect(response.status).toBe(200);
    expect(response.body.toString("utf8")).toContain("owned page, café ☕");
    expect(response.headers["transfer-encoding"]).toBeUndefined();
    expect(response.headers["content-length"]).toBe(String(response.body.byteLength));
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.headers.link).toBe('</index.md>; rel="alternate"; type="text/markdown"');
    expect(
      response.headers["set-cookie"]?.filter((cookie) => cookie.startsWith("visit=")),
    ).toHaveLength(1);
  });

  it("keeps streaming a page that suspends", async () => {
    const response = await rawGet(`${base}/stream`, { headers: { "accept-encoding": "identity" } });
    expect(response.status).toBe(200);
    expect(response.headers["transfer-encoding"]).toBe("chunked");
    expect(response.headers["content-length"]).toBeUndefined();
    expect(response.body.toString("utf8")).toContain("slow part");
  });

  it("sends the not-found page with its status and byte length", async () => {
    const response = await rawGet(`${base}/missing-page`, {
      headers: { "accept-encoding": "identity" },
    });
    expect(response.status).toBe(404);
    expect(response.headers["content-length"]).toBe(String(response.body.byteLength));
    expect(response.headers["x-middleware"]).toBe("1");
  });

  it("answers HEAD for a buffered page without a body", async () => {
    const response = await rawGet(`${base}/`, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.body.byteLength).toBe(0);
    expect(response.headers["x-middleware"]).toBe("1");
    expect(response.headers.link).toBe('</index.md>; rel="alternate"; type="text/markdown"');
  });

  it("serves precompressed client assets on node-server", async () => {
    const html = (
      await rawGet(`${base}/`, { headers: { "accept-encoding": "identity" } })
    ).body.toString("utf8");
    const script = html.match(/<script[^>]+src="(\/[^"]+\.js)"/)?.[1];
    expect(script).toBeTruthy();

    const identity = await rawGet(`${base}${script}`, {
      headers: { "accept-encoding": "identity" },
    });
    expect(identity.status).toBe(200);
    expect(identity.headers["content-encoding"]).toBeUndefined();

    const gzip = await rawGet(`${base}${script}`, { headers: { "accept-encoding": "gzip, br" } });
    expect(gzip.status).toBe(200);
    expect(gzip.headers["content-encoding"]).toBe("gzip");
    expect(gzip.body.byteLength).toBeLessThan(identity.body.byteLength);
    expect(gunzipSync(gzip.body).equals(identity.body)).toBe(true);

    // Only gzip is precompressed; a brotli-only client gets the plain file.
    const brotliOnly = await rawGet(`${base}${script}`, { headers: { "accept-encoding": "br" } });
    expect(brotliOnly.headers["content-encoding"]).toBeUndefined();
    expect(brotliOnly.body.equals(identity.body)).toBe(true);
  });

  it("decodes a brotli page body that matches the identity body", async () => {
    const identity = await rawGet(`${base}/`, { headers: { "accept-encoding": "identity" } });
    const response = await rawGet(`${base}/`, { headers: { "accept-encoding": "br" } });
    expect(response.headers["content-encoding"]).toBe("br");
    expect(response.headers.vary).toBe("Accept, Accept-Encoding");
    expect(brotliDecompressSync(response.body).toString("utf8")).toBe(
      identity.body.toString("utf8"),
    );
  });

  it("decodes a gzip page body that matches the identity body", async () => {
    const identity = await (
      await fetch(`${base}/`, { headers: { "accept-encoding": "identity" } })
    ).text();
    const raw = await new Promise<Buffer>((resolve, reject) => {
      import("node:http").then(({ get }) =>
        get(`${base}/`, { headers: { "accept-encoding": "gzip" } }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => resolve(Buffer.concat(chunks)));
        }).on("error", reject),
      );
    });
    expect(gunzipSync(raw).toString("utf8")).toBe(identity);
  });
});
