// @vitest-environment node

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync, createBrotliDecompress, gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startProductionServer, type ProductionServer } from "./production-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;

const files: Record<string, string> = {
  "package.json": JSON.stringify({ private: true, type: "module" }),
  "farm.config.ts": `export default ${JSON.stringify({ srcDir: "src", images: { provider: "none" }, telemetry: false })};\n`,
  "src/app/layout.tsx": `export default function Layout({ children }) { return <html><body>{children}</body></html>; }\n`,
  "src/app/page.tsx": `export default function Page() { return <main>${"compressed page on bun. ".repeat(80)}</main>; }\n`,
  // The slow part waits for the test to call /api/release, so the shell must reach the browser
  // on its own first: a compressor that buffered would hold it back until the page ended.
  "src/app/stream/page.tsx": `
import { Suspense } from "react";

async function Slow() {
  await new Promise((resolve) => { globalThis.__farmReleaseStream = resolve; });
  return <p>slow part</p>;
}

export default function Page() {
  return <main><h1>stream page</h1><Suspense fallback={<p>loading</p>}><Slow /></Suspense></main>;
}
`,
  "src/app/api/release/route.ts": `
export async function GET() {
  globalThis.__farmReleaseStream?.();
  return new Response(null, { status: 204 });
}
`,
};

/** The response's own bytes: fetch would decode them and hide what the server sent. */
function rawGet(url: string, acceptEncoding: string) {
  return new Promise<{ encoding: string | undefined; body: Buffer }>((resolve, reject) => {
    http
      .get(url, { headers: { "accept-encoding": acceptEncoding } }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({ encoding: response.headers["content-encoding"], body: Buffer.concat(chunks) }),
        );
        response.on("error", reject);
      })
      .on("error", reject);
  });
}

describe.skipIf(!hasBun)("production compression on a bun build", () => {
  let root = "";
  let server: ProductionServer | undefined;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-bun-compression-"));
    await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
    // Junctions need no Windows privilege; the type is ignored on POSIX.
    await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
    for (const [file, source] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), source.trim());
    }
    const userConfig = await loadConfig(root, undefined, "production");
    const config = await resolveConfig({ ...userConfig, root }, "production");
    await build(config, { root, preset: "bun" });
    server = await startProductionServer(path.join(root, ".farm", ".output", "server"), {
      command: "bun",
    });
  }, 180_000);

  afterAll(async () => {
    await server?.stop();
    if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("compresses a page with brotli or gzip, by Accept-Encoding", async () => {
    const identity = await rawGet(`${server!.origin}/`, "identity");
    expect(identity.encoding).toBeUndefined();
    expect(identity.body.toString()).toContain("compressed page on bun.");

    const brotli = await rawGet(`${server!.origin}/`, "gzip, deflate, br");
    expect(brotli.encoding).toBe("br");
    expect(brotliDecompressSync(brotli.body).equals(identity.body)).toBe(true);
    expect(brotli.body.byteLength).toBeLessThan(identity.body.byteLength);

    const gzip = await rawGet(`${server!.origin}/`, "gzip");
    expect(gzip.encoding).toBe("gzip");
    expect(gunzipSync(gzip.body).equals(identity.body)).toBe(true);
  });

  it("sends a suspending page's shell before the page ends", async () => {
    const result = await new Promise<{ encoding?: string; first: string; whole: string }>(
      (resolve, reject) => {
        http
          .get(`${server!.origin}/stream`, { headers: { "accept-encoding": "br" } }, (response) => {
            const encoding = response.headers["content-encoding"];
            // An uncompressed answer is read as is, so a failing run still ends.
            const decode = encoding === "br" ? createBrotliDecompress() : new PassThrough();
            let text = "";
            let first = "";
            decode.on("data", (chunk: Buffer) => {
              text += chunk.toString();
              if (!first && text.includes("stream page")) {
                first = text;
                fetch(`${server!.origin}/api/release`).catch(reject);
              }
            });
            decode.on("end", () => resolve({ encoding, first, whole: text }));
            decode.on("error", reject);
            response.pipe(decode);
          })
          .on("error", reject);
      },
    );
    expect(result.encoding).toBe("br");
    expect(result.first).toContain("loading");
    expect(result.first).not.toContain("slow part");
    expect(result.whole).toContain("slow part");
  });
});
