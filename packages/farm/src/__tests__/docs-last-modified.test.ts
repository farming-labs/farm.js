// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveDocsConfig } from "../config";
import { createFarmDocsHandler } from "../docs";
import { discoverFarmDocsPages, loadFarmDocsPage } from "../docs/handler";
import { createFarmDocsLastModifiedManifest } from "../docs/last-modified";
import { getFarmDocsGuardedPaths } from "../nitro/universal-build";

// Resolving a page date can run `git log` over the whole docs history, which made every
// production build pay for it while only listing page paths.

const gitCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const execFileSync = ((file: string, ...rest: unknown[]) => {
    if (file === "git") gitCalls.count += 1;
    return (actual.execFileSync as (...args: unknown[]) => unknown)(file, ...rest);
  }) as typeof actual.execFileSync;
  return { ...actual, execFileSync };
});

const { execFileSync } = await import("node:child_process");

const COMMIT_DATE = "2026-06-12T09:30:00.000Z";
const FRONTMATTER_DATE = "2025-01-02T03:04:05.000Z";

async function createGitDocsFixture(lastUpdated?: false) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-lastmod-")));
  const docsDir = path.join(root, "src", "app", "docs");
  const write = async (relativePath: string, source: string) => {
    await fs.mkdir(path.dirname(path.join(docsDir, relativePath)), { recursive: true });
    await fs.writeFile(path.join(docsDir, relativePath), source);
  };
  await write("page.md", "# Farm Docs\n\nWelcome.\n");
  await write("internal/page.md", "# Internal\n\nGuarded.\n");
  await write("guide/page.md", `---\nlastModified: ${FRONTMATTER_DATE}\n---\n# Guide\n`);

  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      stdio: "ignore",
      env: { ...process.env, GIT_AUTHOR_DATE: COMMIT_DATE, GIT_COMMITTER_DATE: COMMIT_DATE },
    });
  git(["init"]);
  git(["config", "user.email", "farm@example.com"]);
  git(["config", "user.name", "Farm Docs"]);
  git(["add", "."]);
  git(["commit", "-m", "docs: add pages"]);

  const old = new Date("2018-10-20T12:00:00.000Z");
  await fs.utimes(path.join(docsDir, "page.md"), old, old);

  const docs = await resolveDocsConfig(
    { entry: "/docs", ...(lastUpdated === false ? { config: { lastUpdated } } : {}) },
    { root, srcDir: "src" },
  );
  gitCalls.count = 0;
  return { root, docs, docsDir };
}

async function withFixture(
  lastUpdated: false | undefined,
  run: (fixture: Awaited<ReturnType<typeof createGitDocsFixture>>) => Promise<void>,
) {
  const fixture = await createGitDocsFixture(lastUpdated);
  try {
    await run(fixture);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

describe("docs page last-modified dates", () => {
  it("are not read from Git when a build only needs guarded page paths", async () => {
    await withFixture(undefined, async ({ root, docs }) => {
      const guarded = getFarmDocsGuardedPaths(
        { docs, root, srcDir: "src", middleware: [{ matcher: "/docs/internal" }] } as never,
        [],
      );

      expect(guarded).toEqual(["/docs/internal"]);
      expect(gitCalls.count).toBe(0);
    });
  });

  it("resolve on first read to the same Git, frontmatter, and listing values", async () => {
    await withFixture(undefined, async ({ docs, docsDir }) => {
      const pages = discoverFarmDocsPages(docsDir, docs);
      expect(pages.map((page) => page.href)).toEqual(["/docs", "/docs/guide", "/docs/internal"]);
      expect(gitCalls.count).toBe(0);

      const commitDate = pages[0]!.lastModified;
      expect(commitDate && new Date(commitDate).toISOString()).toBe(COMMIT_DATE);
      expect(commitDate).toBe(createFarmDocsLastModifiedManifest(docsDir).pages["page.md"]);
      expect(pages[1]!.lastModified).toBe(FRONTMATTER_DATE);
      expect(loadFarmDocsPage(docsDir, docs, "")!.lastModified).toBe(commitDate);

      expect(Object.keys(pages[0]!)).toEqual([
        "slug",
        "title",
        "description",
        "section",
        "href",
        "sourcePath",
        "lastModified",
      ]);
      expect(JSON.parse(JSON.stringify(pages[0]))).toMatchObject({ lastModified: commitDate });
      expect({ ...pages[2]! }.lastModified).toBe(commitDate);

      pages[0]!.lastModified = "2020-01-01T00:00:00.000Z";
      expect(pages[0]!.lastModified).toBe("2020-01-01T00:00:00.000Z");
    });
  });

  it("still reach the sitemap and the rendered page when last-updated is shown", async () => {
    await withFixture(undefined, async ({ root, docs }) => {
      const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });
      const sitemap = await (await handler(new Request("http://farm.test/sitemap.xml")))?.text();
      expect(sitemap).toContain(
        "<loc>http://farm.test/docs</loc>\n    <lastmod>2026-06-12</lastmod>",
      );
      expect(sitemap).toContain(
        "<loc>http://farm.test/docs/guide</loc>\n    <lastmod>2025-01-02</lastmod>",
      );

      const manifest = createFarmDocsLastModifiedManifest(path.join(root, "src", "app", "docs"));
      const html = await (
        await handler(new Request("http://farm.test/docs", { headers: { accept: "text/html" } }))
      )?.text();
      expect(html).toContain(`datetime="${manifest.pages["page.md"]}"`);
      expect(html).toContain("June 12, 2026");
    });
  });

  it("are not read from Git to render a page that hides last-updated", async () => {
    await withFixture(false, async ({ root, docs }) => {
      const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });
      const response = await handler(
        new Request("http://farm.test/docs", { headers: { accept: "text/html" } }),
      );
      const html = await response?.text();

      expect(response?.status).toBe(200);
      expect(html).toContain("Welcome.");
      expect(html).not.toContain("<time datetime=");
      expect(gitCalls.count).toBe(0);
    });
  });
});
