// @vitest-environment node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const execFileAsync = promisify(execFile);
const PATHS = ["/v2/api/admin/users", "/api/admin/users", "/v2/api/ping"];

// The server reads its bundle once, so a fresh process fetches every path.
const PROBE_SOURCE = `
const { default: handler } = await import(process.env.FARM_TEST_FUNCTION_URL);
const results = {};
for (const pathname of ${JSON.stringify(PATHS)}) {
  const response = await handler.fetch(new Request("https://acme.test" + pathname));
  results[pathname] = { status: response.status, body: await response.text() };
}
process.stdout.write(JSON.stringify(results));
`;

async function write(root: string, relativePath: string, source: string) {
  await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
  await fs.writeFile(path.join(root, relativePath), source);
}

describe("production api.basePath middleware", () => {
  it("runs src/app/api middleware for the public API path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-production-api-base-path-"));
    try {
      await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
      await fs.symlink(
        packageRoot,
        path.join(root, "node_modules", "@farm.js", "core"),
        "junction",
      );
      for (const name of ["react", "react-dom"]) {
        await fs.symlink(
          await fs.realpath(path.join(packageRoot, "node_modules", name)),
          path.join(root, "node_modules", name),
          "junction",
        );
      }
      await write(root, "package.json", '{"type":"module","private":true}');
      await write(
        root,
        "src/app/layout.tsx",
        "export default function Layout({ children }) { return <main>{children}</main>; }",
      );
      await write(
        root,
        "src/app/page.tsx",
        "export default function Page() { return <p>home</p>; }",
      );
      await write(
        root,
        "src/app/api/admin/middleware.ts",
        'export default function guard() { return new Response("denied", { status: 401 }); }',
      );
      await write(
        root,
        "src/app/api/admin/users/route.ts",
        'export function GET() { return Response.json(["secret"]); }',
      );
      await write(
        root,
        "src/app/api/ping/route.ts",
        "export function GET() { return Response.json({ ok: true }); }",
      );

      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          deploy: { target: "vercel" },
          api: { basePath: "/v2/api" },
        },
        "production",
      );
      await build(config, { root, preset: "vercel" });
      const functionUrl = pathToFileURL(
        path.resolve(root, config.deploy.outputDir, "functions", "__nitro.func", "index.mjs"),
      ).href;

      const { stdout } = await execFileAsync(
        process.execPath,
        ["--input-type=module", "--eval", PROBE_SOURCE],
        { env: { ...process.env, FARM_TEST_FUNCTION_URL: functionUrl } },
      );
      expect(JSON.parse(stdout)).toEqual({
        "/v2/api/admin/users": { status: 401, body: "denied" },
        "/api/admin/users": { status: 401, body: "denied" },
        "/v2/api/ping": { status: 200, body: '{"ok":true}' },
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
