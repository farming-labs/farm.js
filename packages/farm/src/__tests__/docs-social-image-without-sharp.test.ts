// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFarmDocsHandler } from "../docs";
import type { FarmDocsResolvedConfig } from "../docs/types";

vi.mock("sharp", () => {
  throw Object.assign(new Error("Cannot find package 'sharp' imported from farm"), {
    code: "ERR_MODULE_NOT_FOUND",
  });
});

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("docs social images without sharp", () => {
  it("keeps advertising and serving the SVG image", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-no-sharp-"));
    roots.push(root);
    const contentDir = path.join(root, "src", "app", "docs");
    await fs.mkdir(contentDir, { recursive: true });
    await fs.writeFile(path.join(contentDir, "page.md"), "---\ntitle: Home\n---\n\n# Home\n");
    const docs: FarmDocsResolvedConfig = {
      enabled: true,
      entry: "/docs",
      contentDir,
      config: { entry: "docs", docsPath: "/docs", contentDir },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });

    const html = (await (await handler(new Request("http://farm.test/docs")))?.text()) || "";
    const imageUrl = html.match(/property="og:image" content="([^"]+)"/)?.[1];
    expect(imageUrl).toMatch(/\/docs\/_social\/index\/opengraph-image\.svg\?v=[a-f0-9]{16}$/);
    expect(html).toContain('<meta property="og:image:type" content="image/svg+xml">');

    const svg = await handler(new Request(imageUrl!));
    expect(svg?.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(
      await handler(new Request("http://farm.test/docs/_social/index/opengraph-image.png")),
    ).toBeNull();
    // A missing optional peer is the expected setup, not a warning.
    expect(warn).not.toHaveBeenCalled();
  });
});
