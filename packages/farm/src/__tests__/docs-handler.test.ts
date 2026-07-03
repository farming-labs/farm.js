// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDocsConfig } from "../config";
import { createFarmDocsHandler } from "../docs";

describe("createFarmDocsHandler", () => {
  async function createDocsFixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-handler-"));
    const docsDir = path.join(root, "src", "app", "docs");
    await fs.mkdir(path.join(docsDir, "guide"), { recursive: true });
    await fs.writeFile(
      path.join(docsDir, "page.md"),
      [
        "---",
        "title: Farm Docs",
        "description: Local docs",
        "---",
        "",
        "# Farm Docs",
        "",
        "Welcome to **Farm** docs.",
      ].join("\n"),
    );
    await fs.writeFile(path.join(docsDir, "guide", "page.md"), ["# Guide", "", "Use `farm dev` to start."].join("\n"));
    const docs = await resolveDocsConfig({ entry: "/docs" }, { root, srcDir: "src" });
    return { root, docs };
  }

  it("serves docs markdown files as HTML", async () => {
    const { root, docs } = await createDocsFixture();
    const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });

    const response = await handler(
      new Request("http://farm.test/docs", {
        headers: { accept: "text/html" },
      }),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("text/html");
    await expect(response?.text()).resolves.toContain("<h1>Farm Docs</h1>");
  });

  it("serves markdown when requested by markdown URL", async () => {
    const { root, docs } = await createDocsFixture();
    const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });

    const response = await handler(new Request("http://farm.test/docs/guide.md"));

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("text/markdown");
    await expect(response?.text()).resolves.toContain("Use `farm dev` to start.");
  });

  it("returns null when docs are disabled", async () => {
    const { root, docs } = await createDocsFixture();
    const handler = createFarmDocsHandler({ ...docs, enabled: false }, { root, srcDir: "src" });

    await expect(handler(new Request("http://farm.test/docs"))).resolves.toBeNull();
  });
});
