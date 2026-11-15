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
const PATHS = ["/", "/api/ping", "/missing"];

/**
 * The server reads its environment once at startup, so each runtime
 * environment gets a fresh process that fetches every path and reports its
 * status and X-Robots-Tag.
 */
const PROBE_SOURCE = `
const { default: handler } = await import(process.env.FARM_TEST_FUNCTION_URL);
const results = {};
for (const pathname of ${JSON.stringify(PATHS)}) {
  const response = await handler.fetch(new Request("https://acme.test" + pathname));
  await response.arrayBuffer();
  results[pathname] = { status: response.status, robotsTag: response.headers.get("x-robots-tag") };
}
process.stdout.write(JSON.stringify(results));
`;

async function probe(functionUrl: string, env: Record<string, string>) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", PROBE_SOURCE],
    {
      env: {
        ...process.env,
        FARM_PREVIEW: "",
        VERCEL_ENV: "",
        ...env,
        FARM_TEST_FUNCTION_URL: functionUrl,
      },
    },
  );
  return JSON.parse(stdout) as Record<string, { status: number; robotsTag: string | null }>;
}

function expectRobotsTag(
  results: Record<string, { status: number; robotsTag: string | null }>,
  robotsTag: string | null,
) {
  expect(results).toEqual({
    "/": { status: 200, robotsTag },
    "/api/ping": { status: 200, robotsTag },
    "/missing": { status: 404, robotsTag },
  });
}

/** Build a small app for Vercel with `buildEnv` set during the build only. */
async function buildApp(root: string, buildEnv: Record<string, string> = {}): Promise<string> {
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module","private":true}');
  const app = path.join(root, "src", "app");
  await fs.mkdir(path.join(app, "api", "ping"), { recursive: true });
  await fs.writeFile(
    path.join(app, "layout.tsx"),
    "export default function Layout({ children }) { return <main>{children}</main>; }",
  );
  await fs.writeFile(
    path.join(app, "page.tsx"),
    "export default function Page() { return <p>home</p>; }",
  );
  await fs.writeFile(
    path.join(app, "api", "ping", "route.ts"),
    "export function GET() { return Response.json({ ok: true }); }",
  );

  const config = await resolveConfig(
    {
      root,
      srcDir: "src",
      images: { provider: "none" },
      telemetry: false,
      deploy: { target: "vercel" },
      agent: { noindexPreviews: true },
    },
    "production",
  );
  const previous = Object.fromEntries(Object.keys(buildEnv).map((key) => [key, process.env[key]]));
  Object.assign(process.env, buildEnv);
  try {
    await build(config, { root, preset: "vercel" });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return pathToFileURL(
    path.resolve(root, config.deploy.outputDir, "functions", "__nitro.func", "index.mjs"),
  ).href;
}

describe("production agent.noindexPreviews", () => {
  it("marks every server response when the runtime is a preview", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-production-noindex-"));
    try {
      const functionUrl = await buildApp(root);

      expectRobotsTag(await probe(functionUrl, {}), null);
      expectRobotsTag(await probe(functionUrl, { VERCEL_ENV: "production" }), null);
      expectRobotsTag(await probe(functionUrl, { VERCEL_ENV: "preview" }), "noindex, nofollow");
      expectRobotsTag(await probe(functionUrl, { FARM_PREVIEW: "1" }), "noindex, nofollow");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("keeps a preview build marked unless FARM_PREVIEW=0 at runtime", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-production-noindex-build-"));
    try {
      // Netlify exposes its deploy context only to the build.
      const functionUrl = await buildApp(root, { FARM_PREVIEW: "1" });

      expectRobotsTag(await probe(functionUrl, {}), "noindex, nofollow");
      expectRobotsTag(await probe(functionUrl, { FARM_PREVIEW: "0" }), null);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
