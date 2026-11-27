// @vitest-environment node

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const COMMIT_DATE = "2020-01-02T03:04:05Z";
const FILE_TIME = new Date("2030-06-07T08:09:10Z");

// Reads a page's date as `@farming-labs/farmjs` does: from the manifest Farm writes beside the
// content, else from the file's modification time. A relative `contentDir` is under `rootDir`.
const ADAPTER_SERVER = `import fs from "node:fs";
import path from "node:path";
export function listFarmDocsPages(config) {
  return [config.docsPath + "/guide"];
}
export function createFarmDocsRuntimeHandler(config, { rootDir }) {
  const contentDir = path.resolve(rootDir, config.contentDir);
  return async (request) => {
    if (new URL(request.url).pathname !== "/docs/guide") return null;
    let date;
    try {
      const manifest = path.join(contentDir, ".farm-docs-last-modified.json");
      date = JSON.parse(fs.readFileSync(manifest, "utf8")).pages["guide/page.md"];
    } catch {}
    date ??= fs.statSync(path.join(contentDir, "guide", "page.md")).mtime.toISOString();
    return new Response(
      '<!doctype html><html><head></head><body><main data-last-modified="' + date + '">Guide</main></body></html>',
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  };
}
`;

async function write(root: string, relativePath: string, source: string) {
  await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
  await fs.writeFile(path.join(root, relativePath), source);
}

/** A docs app in its own Git repository, whose guide was committed in 2020 but touched in 2030. */
async function createDocsApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-prerender-dates-"));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
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
  await write(root, ".gitignore", "node_modules\n.farm\n.vercel\n");
  await write(root, "package.json", '{"type":"module","private":true}');
  await write(
    root,
    "src/app/layout.tsx",
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
  );
  await write(root, "src/app/docs/guide/page.md", "# Guide\n");

  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], {
      stdio: "ignore",
      env: { ...process.env, GIT_AUTHOR_DATE: COMMIT_DATE, GIT_COMMITTER_DATE: COMMIT_DATE },
    });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=Farm", "-c", "user.email=farm@example.com", "commit", "-q", "-m", "docs");
  // A fresh clone gives every file the checkout's time; here it is far from the commit's.
  await fs.utimes(path.join(root, "src/app/docs/guide/page.md"), FILE_TIME, FILE_TIME);
  return root;
}

async function buildDocsApp(root: string, target: "node" | "vercel"): Promise<void> {
  const config = await resolveConfig(
    {
      root,
      srcDir: "src",
      images: { provider: "none" },
      telemetry: false,
      deploy: { target },
      docs: {
        enabled: true,
        entry: "/docs",
        contentDir: "src/app/docs",
        prerender: true,
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
  await build(config, { root, preset: config.deploy.preset });
}

/** The page's date as a timestamp: Git may write UTC as `Z` or `+00:00`. */
const lastModified = (html: string) => {
  const value = html.match(/data-last-modified="([^"]+)"/)?.[1];
  return value === undefined ? undefined : Date.parse(value);
};

async function findDirectories(dir: string, name: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name === name)
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)));
}

describe("docs.prerender with a docs adapter", () => {
  it("dates a prerendered page on Vercel from its last commit, as the function does", async () => {
    const root = await createDocsApp();
    try {
      await buildDocsApp(root, "vercel");
      const outputDir = path.join(root, ".vercel", "output");
      const page = await fs.readFile(
        path.join(outputDir, "static", "docs", "guide", "index.html"),
        "utf8",
      );
      // A Vercel build checks every file out fresh, so its time is the build's, not the edit's.
      expect(lastModified(page)).toBe(Date.parse(COMMIT_DATE));

      const { default: handler } = await import(
        /* @vite-ignore */ pathToFileURL(
          path.join(outputDir, "functions", "__nitro.func", "index.mjs"),
        ).href
      );
      const live: Response = await handler.fetch(
        new Request("https://docs.example.com/docs/guide"),
      );
      expect(lastModified(await live.text())).toBe(lastModified(page));

      // The prerender server's copy of the content does not ship.
      expect(await findDirectories(outputDir, "farm-docs-content")).toEqual([
        path.join("functions", "__nitro.func", "farm-docs-content"),
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
