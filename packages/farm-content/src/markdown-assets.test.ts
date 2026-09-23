import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ContentAssetContext } from "./assets.js";
import { resolveMarkdownAssets } from "./markdown-assets.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function context(sourceFile = "post.mdx"): Promise<ContentAssetContext> {
  const root = await mkdtemp(path.join(tmpdir(), "farm-mdx-assets-"));
  roots.push(root);
  await writeFile(
    path.join(root, "hero.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"/>',
  );
  await writeFile(path.join(root, "guide.pdf"), "%PDF guide");
  return { root, sourceFile, collectionName: "posts", sourceFiles: new Set(), imports: new Map() };
}

describe("Markdown and MDX body assets", () => {
  it.each([
    '{"![Example](./missing.png)"}',
    'Inline {"[Download](./missing.pdf)"} text.',
    "{/* ![Example](./missing.png) */}",
    'export const example = "![Example](./missing.png)";\n\n# Example',
    '<Card label={"![Example](./missing.png)"} />',
    '<Card label="![Example](./missing.png)" />',
    'import example from "./missing.js";\n\n{(() => { throw new Error("must not execute"); })()}',
  ])("leaves MDX code and attributes unchanged: %s", async (body) => {
    const input = await context();
    const resolved = await resolveMarkdownAssets(body, input);
    expect(resolved).toEqual({ body, assets: [] });
    expect(input.imports.size).toBe(0);
    expect(input.sourceFiles.size).toBe(0);
  });

  it("manages actual Markdown nested inside JSX without touching adjacent JavaScript", async () => {
    const input = await context();
    const body =
      '<Card label={"![Example](./missing.png)"}>\n  ![Hero](./hero.svg)\n\n  [Download][guide]\n</Card>\n\n[guide]: ./guide.pdf\n';
    const resolved = await resolveMarkdownAssets(body, input);
    expect(resolved.assets).toMatchObject([
      { kind: "image", source: "./hero.svg", width: 32, height: 24 },
      { kind: "file", source: "./guide.pdf" },
    ]);
    expect(resolved.assets).toHaveLength(2);
    expect(resolved.body).toContain('<Card label={"![Example](./missing.png)"}>');
    expect(resolved.body).toContain("![Hero](__FARM_CONTENT_ASSET_");
    expect(resolved.body).toContain("[guide]: __FARM_CONTENT_ASSET_");
    expect(input.imports.size).toBe(2);
  });

  it("does not rewrite image-looking JavaScript strings even when that file exists", async () => {
    const body = '{"![Example](./hero.svg)"}';
    expect(await resolveMarkdownAssets(body, await context("post.MDX"))).toEqual({
      body,
      assets: [],
    });
  });

  it("preserves ordinary Markdown rules for braces and code fences", async () => {
    const body = '{"![Hero](./hero.svg)"}\n\n```mdx\n{"![Example](./missing.png)"}\n```\n';
    const result = await resolveMarkdownAssets(body, await context("post.md"));
    expect(result.assets).toHaveLength(1);
    expect(result.body).toContain('{"![Hero](__FARM_CONTENT_ASSET_');
    expect(result.body).toContain('{"![Example](./missing.png)"}');
  });

  it("still reports missing real Markdown images in MDX", async () => {
    await expect(
      resolveMarkdownAssets("![Missing](./missing.png)", await context()),
    ).rejects.toThrow('Asset "./missing.png" does not exist');
  });

  it("reports invalid MDX syntax with the content file without evaluating it", async () => {
    await expect(resolveMarkdownAssets("{not closed", await context())).rejects.toThrow(
      "Could not inspect Markdown assets in post.mdx",
    );
  });
});
