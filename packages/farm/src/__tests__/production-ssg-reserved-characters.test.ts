// @vitest-environment node

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let root: string | undefined;
let server: ChildProcess | undefined;
let serverExited: Promise<unknown> | undefined;
let origin = "";
const output: string[] = [];

async function listFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
    );
}

/** The id the page rendered, and whether two requests got the same render (a static file). */
async function visit(pathname: string): Promise<{ status: number; id?: string; static: boolean }> {
  const renders = await Promise.all(
    [0, 1].map(async () => {
      const response = await fetch(`${origin}${pathname}`);
      const html = await response.text();
      return {
        status: response.status,
        id: html.match(/data-id="([^"]*)"/)?.[1],
        at: html.match(/data-at="([^"]*)"/)?.[1],
      };
    }),
  );
  return {
    status: renders[0]!.status,
    id: renders[0]!.id,
    static: renders[0]!.at === renders[1]!.at,
  };
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(packageRoot, ".tmp-ssg-reserved-characters-"));
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
    "src/app/post/[id]/page.tsx",
    `export const dynamic = "force-static";
export function generateStaticParams() {
  return [{ id: "plain" }, { id: "a b" }, { id: "a+b" }, { id: "h#1" }, { id: "x?y" }, { id: "a/b" }, { id: "100%" }];
}
export default function Post({ params }) {
  return <main data-id={params.id} data-at={String(Date.now() + Math.random())}>post</main>;
}`,
  );
  const config = await resolveConfig(
    { root, srcDir: "src", telemetry: false, images: { provider: "none" } },
    "production",
  );
  await build(config, { root, preset: "node-server" });

  const serverDirectory = path.join(root, ".farm", ".output", "server");
  const port = await getAvailablePort();
  origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(serverDirectory, "index.mjs")], {
    cwd: serverDirectory,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverExited = new Promise((resolve) => server!.once("exit", resolve));
  server.stdout?.on("data", (chunk) => output.push(String(chunk)));
  server.stderr?.on("data", (chunk) => output.push(String(chunk)));
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      await fetch(`${origin}/post/plain`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Production server did not start\n${output.join("")}`);
}, 180_000);

afterAll(async () => {
  // Windows refuses to remove the output while the server still holds it as its cwd.
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill();
    await serverExited;
  }
  if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("static params with characters a URL only keeps escaped", () => {
  it("prerenders only the pages whose URL the prerenderer keeps", async () => {
    const files = await listFiles(path.join(root!, ".farm", ".output", "public", "post"));
    expect(files.filter((file) => file.endsWith(".html")).sort()).toEqual([
      "a+b/index.html",
      "plain/index.html",
    ]);
  });

  it("serves every page at its own URL with its own param", async () => {
    expect(await visit("/post/plain")).toEqual({ status: 200, id: "plain", static: true });
    expect(await visit("/post/a%2Bb")).toEqual({ status: 200, id: "a+b", static: true });
    // Rendered on request, for the param the URL names.
    expect(await visit("/post/a%20b")).toEqual({ status: 200, id: "a b", static: false });
    expect(await visit("/post/h%231")).toEqual({ status: 200, id: "h#1", static: false });
    expect(await visit("/post/x%3Fy")).toEqual({ status: 200, id: "x?y", static: false });
    expect(await visit("/post/a%2Fb")).toEqual({ status: 200, id: "a/b", static: false });
    expect(await visit("/post/100%25")).toEqual({ status: 200, id: "100%", static: false });
    // A two-segment URL is not the [id] page.
    expect((await visit("/post/a/b")).status).toBe(404);
  });
});
