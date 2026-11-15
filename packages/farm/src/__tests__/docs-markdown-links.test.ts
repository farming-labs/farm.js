// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDocsConfig } from "../config";
import { createFarmDocsHandler } from "../docs";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function renderPage(body: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-links-"));
  roots.push(root);
  const docsDir = path.join(root, "src", "app", "docs");
  await fs.mkdir(path.join(docsDir, "links"), { recursive: true });
  await fs.writeFile(path.join(docsDir, "page.md"), "# Index\n\nIndex page.");
  await fs.writeFile(path.join(docsDir, "links", "page.md"), body);
  const docs = await resolveDocsConfig(
    { entry: "/docs", config: { entry: "docs" } },
    { root, srcDir: "src" },
  );
  const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });
  const response = await handler(
    new Request("http://farm.test/docs/links", { headers: { accept: "text/html" } }),
  );
  expect(response?.status).toBe(200);
  return (await response?.text()) || "";
}

describe("docs Markdown links", () => {
  it("renders script URLs as plain text", async () => {
    const html = await renderPage(
      [
        "# Links",
        "",
        "[inline](javascript:alert(1)) [mixed](JaVaScRiPt:alert(2)) [vb](vbscript:msgbox(3))",
        "[data](data:text/html,<script>alert(4)</script>) [reference][ref] <javascript:alert(6)>",
        "",
        "[ref]: javascript:alert(5)",
      ].join("\n"),
    );

    expect(html).not.toMatch(/href="\s*(?:javascript|vbscript|data:text)/i);
    for (const text of ["inline", "mixed", "vb", "data", "reference"]) {
      expect(html).toContain(text);
    }
  });

  it("keeps ordinary links", async () => {
    const html = await renderPage(
      [
        "# Links",
        "",
        '[site](https://farmjs.dev "Farm") [guide](/docs/guide) [section](#setup) [mail](mailto:hi@farmjs.dev)',
      ].join("\n"),
    );

    expect(html).toContain('<a href="https://farmjs.dev" title="Farm">site</a>');
    expect(html).toContain('<a href="/docs/guide">guide</a>');
    expect(html).toContain('<a href="#setup">section</a>');
    expect(html).toContain('<a href="mailto:hi@farmjs.dev">mail</a>');
  });
});
